package companion

import com.wingedsheep.ai.engine.AIPlayer
import com.wingedsheep.engine.core.ActivateAbility
import com.wingedsheep.engine.core.CastSpell
import com.wingedsheep.engine.core.ChooseOptionDecision
import com.wingedsheep.engine.core.DeclareAttackers
import com.wingedsheep.engine.core.DeclareBlockers
import com.wingedsheep.engine.core.ChooseTargetsDecision
import com.wingedsheep.engine.core.DecisionResponse
import com.wingedsheep.engine.core.GameConfig
import com.wingedsheep.engine.core.OptionChosenResponse
import com.wingedsheep.engine.core.PendingDecision
import com.wingedsheep.engine.core.PlayLand
import com.wingedsheep.engine.core.PlayerConfig
import com.wingedsheep.engine.core.SubmitDecision
import com.wingedsheep.engine.core.TargetsResponse
import com.wingedsheep.engine.core.YesNoDecision
import com.wingedsheep.engine.core.YesNoResponse
import com.wingedsheep.engine.legalactions.LegalAction
import com.wingedsheep.engine.legalactions.MeaningfulActionFilter
import com.wingedsheep.engine.registry.CardRegistry
import com.wingedsheep.engine.view.ClientEvent
import com.wingedsheep.engine.view.ClientEventTransformer
import com.wingedsheep.engine.view.ClientGameState
import com.wingedsheep.engine.view.ClientStateTransformer
import com.wingedsheep.engine.view.StateDelta
import com.wingedsheep.engine.view.StateDiffCalculator
import com.wingedsheep.gym.GameEnvironment
import com.wingedsheep.gym.RandomActionSelector
import com.wingedsheep.mtg.sets.definitions.por.PortalSet
import com.wingedsheep.sdk.model.Deck
import com.wingedsheep.sdk.model.EntityId
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import java.util.Random

/**
 * The engine on the wire.
 *
 * One process, one table, JSON lines in and out. Nothing else in the app knows
 * what is behind this: the Node relay spawns it for a rules-enforced room and
 * speaks these requests to it, and the browser speaks to the relay exactly as
 * it does for an unenforced room (docs/table-rebuild/PLAN.md, Phase 3 step 3).
 *
 * Every request is one line `{"id": n, "op": "...", ...}` and gets one line
 * back `{"id": n, "ok": true, ...}` or `{"id": n, "ok": false, "error": "..."}`.
 *
 * The rules are Argentum's (`docs/table-rebuild/ENGINE.md`). This file only
 * decides three things the engine leaves open, all of them from FRICTION.md:
 *
 *  - **Law 1, server-side.** A human seat with `autoPass` is never stopped at
 *    a priority window where it has nothing affordable to do; the server
 *    passes for it and says how many times it did (`autoPassed`).
 *  - **The seat opposite can be the engine's own player.** A seat with
 *    `ai: "heuristic"` or `"random"` is driven here, so solo play needs no
 *    second client.
 *  - **Decisions the client cannot yet answer are answered here, and said.**
 *    Targets, yes/no and option choices go to the client. Everything else —
 *    ordering, damage assignment, mana sources — is answered by the engine's
 *    own responder for now and reported under `decided`, so the table can
 *    show what was done on the player's behalf rather than hide it.
 */
const val PROTOCOL = 1

private val json = Json { encodeDefaults = false; ignoreUnknownKeys = true }

private class Seat(val id: EntityId, val name: String, val ai: String?, val autoPass: Boolean)

private class Table(val registry: CardRegistry, val env: GameEnvironment, val seats: List<Seat>) {
    val transformer = ClientStateTransformer(registry)
    val lastView = HashMap<EntityId, ClientGameState>()
    /** What each seat has been told happened, in its own words: the game log. */
    val logs = HashMap<EntityId, MutableList<ClientEvent>>()
    private var logged = 0

    /** Carries the engine's events since the last call into every seat's log, masked for that seat. */
    fun record() {
        val fresh = env.events.drop(logged)
        logged = env.events.size
        if (fresh.isEmpty()) return
        for (seat in seats) logs.getOrPut(seat.id) { mutableListOf() } += ClientEventTransformer.transform(fresh, seat.id)
    }
    val players = HashMap<EntityId, AIPlayer>()
    val randoms = HashMap<EntityId, RandomActionSelector>()

    /** What was last offered to a human seat, so `act` can name an action by index. */
    var offered: List<LegalAction> = emptyList()
    var offeredTo: EntityId? = null

    /** What happened on the way to the current stop, reported once and cleared. */
    var autoPassed = 0
    val decided = mutableListOf<JsonObject>()

    fun seat(id: EntityId): Seat = seats.first { it.id == id }

    fun player(id: EntityId): AIPlayer = players.getOrPut(id) { AIPlayer.create(registry, id) }

    /**
     * Runs the table forward until a human seat has to act, the game ends, or
     * nothing more can happen. AI seats play themselves; a human seat with
     * autoPass is passed for when it has nothing affordable (Law 1); a
     * decision a human cannot answer over this protocol is answered by the
     * engine's responder and noted.
     */
    fun drive() {
        var guard = 0
        offered = emptyList(); offeredTo = null
        while (!env.isTerminal && guard++ < 10_000) {
            val actor = env.agentToAct ?: return
            val seat = seat(actor)
            val decision = env.pendingDecision
            if (decision != null) {
                if (seat.ai == null && decision.isAskable()) return
                val response = player(actor).respondToDecision(env.state, decision)
                if (seat.ai == null) decided += describe(decision)
                env.step(SubmitDecision(actor, response))
                continue
            }
            val actions = env.legalActions()
            if (actions.isEmpty()) return
            if (seat.ai != null) {
                val pick = when (seat.ai) {
                    "random" -> randoms.getOrPut(actor) { RandomActionSelector(Random(actor.value.hashCode().toLong())) }
                        .selectAction(env.state, actions)
                    else -> player(actor).chooseFrom(env.state, actions).action
                }
                env.step(pick)
                continue
            }
            // Law 1 asks the engine's own question: is there something here worth
            // stopping for? Tapping a land for mana is not — a mana ability is a
            // cost, not a play — and a declare-attackers with nothing to declare
            // is not either. MeaningfulActionFilter is the list of what is.
            val canAct = actions.any { MeaningfulActionFilter.isMeaningful(it) && it.affordable }
            val pass = actions.firstOrNull { it.actionType == "PassPriority" }
            // A declare-attackers or declare-blockers window with nothing to
            // declare has no pass action: the empty declaration is the pass.
            val emptyDeclaration = actions.firstOrNull {
                (it.actionType == "DeclareAttackers" || it.actionType == "DeclareBlockers") && !MeaningfulActionFilter.isMeaningful(it)
            }
            if (seat.autoPass && !canAct && (pass ?: emptyDeclaration) != null) {
                autoPassed++
                env.step((pass ?: emptyDeclaration)!!.action)
                continue
            }
            offered = actions; offeredTo = actor
            return
        }
    }

    /** Where the table stands, in the shape every driving reply shares. */
    fun status(): JsonObject = buildJsonObject {
        record()
        put("ok", true)
        put("over", env.isTerminal)
        put("winner", env.winnerId?.value)
        put("turn", env.turnNumber)
        put("phase", env.state.phase.name)
        put("step", env.state.step.name)
        val actor = env.agentToAct
        put("actor", actor?.value)
        val decision = env.pendingDecision
        when {
            env.isTerminal -> put("waiting", JsonNull)
            actor != null && decision != null && decision.isAskable() -> {
                put("waiting", "decision")
                put("decision", describe(decision, full = true))
            }
            actor != null && offeredTo == actor -> {
                put("waiting", "action")
                putJsonArray("actions") { offered.forEachIndexed { i, a -> add(describe(i, a)) } }
            }
            else -> put("waiting", JsonNull)
        }
        put("autoPassed", autoPassed)
        putJsonArray("decided") { decided.forEach { add(it) } }
        autoPassed = 0; decided.clear()
    }

    fun view(viewer: EntityId, delta: Boolean): JsonObject {
        record()
        val next = transformer.transform(env.state, viewer)
        val prev = lastView[viewer]
        lastView[viewer] = next
        return buildJsonObject {
            put("ok", true)
            // The whole log so far, phrased for this seat. A view is asked for
            // once per stop, and a stop is worth a few hundred bytes of history.
            put("log", json.encodeToJsonElement(ListSerializer(ClientEvent.serializer()), logs[viewer] ?: emptyList()))
            if (delta && prev != null) {
                put("delta", json.encodeToJsonElement(StateDelta.serializer(), StateDiffCalculator.computeDelta(prev, next)))
            } else {
                put("state", json.encodeToJsonElement(ClientGameState.serializer(), next))
            }
        }
    }

    fun act(index: Int, params: JsonObject): JsonObject {
        val actor = env.agentToAct ?: throw Refused("The game is not waiting on anyone.")
        if (offeredTo != actor || offered.isEmpty()) throw Refused("No actions are on offer. Ask for the turn first.")
        val offer = offered.getOrNull(index) ?: throw Refused("No action $index; ${offered.size} were offered.")
        // Combat declarations are the one offer the client fills in itself:
        // which creatures, at whom. Left out, it declares nothing.
        val action = when (val a = offer.action) {
            is DeclareAttackers -> DeclareAttackers(actor, params["attackers"]?.jsonObject?.entries
                ?.associate { (k, v) -> EntityId(k) to EntityId(v.jsonPrimitive.content) } ?: emptyMap())
            is DeclareBlockers -> DeclareBlockers(actor, params["blockers"]?.jsonObject?.entries
                ?.associate { (k, v) -> EntityId(k) to v.jsonArray.map { EntityId(it.jsonPrimitive.content) } } ?: emptyMap())
            else -> a
        }
        env.step(action)
        env.lastRejection?.let { throw Refused("The engine refused that: $it") }
        drive()
        return status()
    }

    fun decide(params: JsonObject): JsonObject {
        val actor = env.agentToAct ?: throw Refused("The game is not waiting on anyone.")
        val decision = env.pendingDecision ?: throw Refused("There is no decision to make.")
        val response: DecisionResponse = when {
            params["auto"]?.jsonPrimitive?.boolean == true -> player(actor).respondToDecision(env.state, decision)
            decision is ChooseTargetsDecision -> {
                val chosen = params["targets"]?.jsonObject ?: throw Refused("A targets decision needs \"targets\".")
                TargetsResponse(decision.id, chosen.entries.associate { (k, v) -> k.toInt() to v.jsonArray.map { EntityId(it.jsonPrimitive.content) } })
            }
            decision is YesNoDecision -> YesNoResponse(decision.id, params["yes"]?.jsonPrimitive?.boolean ?: throw Refused("A yes/no decision needs \"yes\"."))
            decision is ChooseOptionDecision -> OptionChosenResponse(decision.id, params["option"]?.jsonPrimitive?.int ?: throw Refused("An option decision needs \"option\"."))
            else -> throw Refused("A ${decision::class.simpleName} can only be answered with \"auto\": true over this protocol.")
        }
        env.step(SubmitDecision(actor, response))
        env.lastRejection?.let { throw Refused("The engine refused that answer: $it") }
        drive()
        return status()
    }

    private fun describe(i: Int, a: LegalAction): JsonObject = buildJsonObject {
        put("index", i)
        put("type", a.actionType)
        put("description", a.description)
        // The card the action is about, so a tap on that card can find it.
        when (val act = a.action) {
            is PlayLand -> put("card", act.cardId.value)
            is CastSpell -> put("card", act.cardId.value)
            is ActivateAbility -> put("card", act.sourceId.value)
            else -> {}
        }
        if (a.isManaAbility) put("mana", true)
        put("affordable", a.affordable)
        put("meaningful", MeaningfulActionFilter.isMeaningful(a))
        put("manaCost", a.manaCostString)
        put("requiresTargets", a.requiresTargets)
        if (a.requiresTargets) {
            put("targetCount", a.targetCount)
            put("minTargets", a.minTargets)
            put("targetDescription", a.targetDescription)
            putJsonArray("validTargets") { a.validTargets?.forEach { add(JsonPrimitive(it.value)) } }
        }
        a.validAttackers?.let { list -> putJsonArray("validAttackers") { list.forEach { add(JsonPrimitive(it.value)) } } }
        a.validAttackTargets?.let { list -> putJsonArray("validAttackTargets") { list.forEach { add(JsonPrimitive(it.value)) } } }
        a.mandatoryAttackers?.takeIf { it.isNotEmpty() }?.let { list -> putJsonArray("mandatoryAttackers") { list.forEach { add(JsonPrimitive(it.value)) } } }
        a.validBlockers?.let { list -> putJsonArray("validBlockers") { list.forEach { add(JsonPrimitive(it.value)) } } }
    }

    private fun describe(d: PendingDecision, full: Boolean = false): JsonObject = buildJsonObject {
        put("id", d.id)
        put("type", d::class.simpleName?.removeSuffix("Decision"))
        put("player", d.playerId.value)
        put("prompt", d.prompt)
        put("source", d.context.sourceName)
        if (!full) return@buildJsonObject
        when (d) {
            is ChooseTargetsDecision -> {
                put("canCancel", d.canCancel)
                putJsonArray("requirements") {
                    d.targetRequirements.forEach { r ->
                        add(buildJsonObject {
                            put("index", r.index); put("description", r.description)
                            put("min", r.minTargets); put("max", r.maxTargets)
                            putJsonArray("legal") { d.legalTargets[r.index]?.forEach { add(JsonPrimitive(it.value)) } }
                        })
                    }
                }
            }
            is YesNoDecision -> { put("yesText", d.yesText); put("noText", d.noText); put("hint", d.hint) }
            is ChooseOptionDecision -> putJsonArray("options") { d.options.forEach { add(JsonPrimitive(it)) } }
            else -> put("askable", false)
        }
    }
}

/** The decisions a client can answer over this protocol; the rest are answered for it and reported. */
private fun PendingDecision.isAskable() =
    this is ChooseTargetsDecision || this is YesNoDecision || this is ChooseOptionDecision

private class Refused(message: String) : RuntimeException(message)

private fun registry(): CardRegistry = CardRegistry().apply {
    register(PortalSet.cards)
    register(PortalSet.basicLands)
}

private fun newTable(registry: CardRegistry, params: JsonObject): Table {
    val players = params["players"]?.jsonArray ?: throw Refused("\"players\" is required.")
    if (players.size < 2) throw Refused("A game needs at least two players.")
    val configs = players.mapIndexed { i, p ->
        val o = p.jsonObject
        val name = o["name"]?.jsonPrimitive?.contentOrNull ?: "Player ${i + 1}"
        val deck = o["deck"]?.jsonObject ?: throw Refused("$name has no deck.")
        val missing = deck.keys.filter { !registry.hasCard(it) }
        if (missing.isNotEmpty()) throw Refused("The engine does not know ${missing.size} of $name's cards: ${missing.joinToString(", ")}")
        val entries = deck.entries.map { (card, n) -> card to n.jsonPrimitive.int }
        PlayerConfig(name = name, deck = Deck.of(*entries.toTypedArray()), startingLife = o["life"]?.jsonPrimitive?.int ?: 20)
    }
    val env = GameEnvironment.create(registry)
    env.reset(GameConfig(
        players = configs,
        skipMulligans = params["skipMulligans"]?.jsonPrimitive?.boolean ?: true,
        startingPlayerIndex = params["startingPlayer"]?.jsonPrimitive?.int ?: 0,
    ))
    val seats = env.playerIds.mapIndexed { i, id ->
        val o = players[i].jsonObject
        Seat(id, configs[i].name, o["ai"]?.jsonPrimitive?.contentOrNull, o["autoPass"]?.jsonPrimitive?.boolean ?: false)
    }
    return Table(registry, env, seats)
}

private fun seatsOf(table: Table): JsonArray = buildJsonArray {
    table.seats.forEach { s ->
        add(buildJsonObject { put("id", s.id.value); put("name", s.name); put("ai", s.ai); put("autoPass", s.autoPass) })
    }
}

fun main() {
    val registry = registry()
    var table: Table? = null
    val out = System.out.bufferedWriter()

    fun reply(id: JsonElement?, body: JsonObject) {
        val line = JsonObject(mapOf("id" to (id ?: JsonNull)) + body)
        out.write(json.encodeToString(JsonObject.serializer(), line)); out.write("\n"); out.flush()
    }

    while (true) {
        val line = readLine() ?: break
        if (line.isBlank()) continue
        val req = try { json.parseToJsonElement(line).jsonObject } catch (e: Exception) {
            reply(null, buildJsonObject { put("ok", false); put("error", "Not a JSON object: ${e.message}") }); continue
        }
        val id = req["id"]
        val body: JsonObject = try {
            when (val op = req["op"]?.jsonPrimitive?.contentOrNull) {
                "hello" -> buildJsonObject {
                    put("ok", true); put("engine", "argentum"); put("protocol", PROTOCOL)
                    put("cards", registry.size)
                    putJsonArray("sets") { add(JsonPrimitive("por")) }
                }
                "cards" -> buildJsonObject {
                    put("ok", true)
                    putJsonArray("names") { registry.allCardNames().sorted().forEach { add(JsonPrimitive(it)) } }
                }
                "new" -> {
                    val t = newTable(registry, req)
                    table = t
                    t.drive()
                    JsonObject(t.status() + mapOf("seats" to seatsOf(t)))
                }
                "turn" -> (table ?: throw Refused("No game yet. Send \"new\" first.")).status()
                "act" -> (table ?: throw Refused("No game yet.")).act(req["index"]?.jsonPrimitive?.int ?: throw Refused("\"index\" is required."), req)
                "decide" -> (table ?: throw Refused("No game yet.")).decide(req)
                "view" -> {
                    val t = table ?: throw Refused("No game yet.")
                    val viewer = req["viewer"]?.jsonPrimitive?.contentOrNull ?: throw Refused("\"viewer\" is required.")
                    val seat = t.seats.firstOrNull { it.id.value == viewer } ?: throw Refused("No seat $viewer.")
                    t.view(seat.id, req["delta"]?.jsonPrimitive?.boolean ?: false)
                }
                "quit" -> { reply(id, buildJsonObject { put("ok", true) }); return }
                null -> throw Refused("\"op\" is required.")
                else -> throw Refused("Unknown op \"$op\".")
            }
        } catch (e: Refused) {
            buildJsonObject { put("ok", false); put("error", e.message) }
        } catch (e: Throwable) {
            System.err.println("engine: ${e::class.simpleName}: ${e.message}")
            buildJsonObject { put("ok", false); put("error", "${e::class.simpleName}: ${e.message}") }
        }
        reply(id, body)
    }
}
