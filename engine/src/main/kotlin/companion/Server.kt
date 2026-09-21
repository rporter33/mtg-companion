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
import com.wingedsheep.engine.core.GameEvent
import com.wingedsheep.engine.core.GameInitializer
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
import com.wingedsheep.engine.registry.PrintingRegistry
import com.wingedsheep.engine.view.ClientEvent
import com.wingedsheep.engine.view.ClientEventTransformer
import com.wingedsheep.engine.view.ClientGameState
import com.wingedsheep.engine.view.ClientStateTransformer
import com.wingedsheep.engine.view.StateDelta
import com.wingedsheep.engine.view.StateDiffCalculator
import com.wingedsheep.gym.GameEnvironment
import com.wingedsheep.gym.RandomActionSelector
import com.wingedsheep.mtg.sets.MtgSetCatalog
import com.wingedsheep.mtg.sets.tokens.PredefinedTokens
import com.wingedsheep.sdk.model.CardDefinition
import com.wingedsheep.sdk.model.MtgSet
import com.wingedsheep.sdk.model.CardEntry
import com.wingedsheep.sdk.model.Deck
import com.wingedsheep.sdk.model.EntityId
import com.wingedsheep.sdk.model.PrintingRef
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
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
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
// 2: a deck line may name its printing, {"count","set","number"} or a list of those, and
// the deal honours it. An engine at 1 reads only counts, so the relay sends it only counts.
const val PROTOCOL = 2

private val json = Json { encodeDefaults = false; ignoreUnknownKeys = true }

private class Seat(
    val id: EntityId,
    val name: String,
    val ai: String?,
    val autoPass: Boolean,
    val sideboardLeftOut: List<String> = emptyList(),
    /** Cards whose chosen printing the engine does not have, so they wear its own art. */
    val unknownPrintings: List<String> = emptyList(),
)

private class Table(val registry: CardRegistry, val env: GameEnvironment, val seats: List<Seat>, val seed: Long, dealt: List<GameEvent> = emptyList()) {
    val transformer = ClientStateTransformer(registry)
    val lastView = HashMap<EntityId, ClientGameState>()
    /** What each seat has been told happened, in its own words: the game log. */
    val logs = HashMap<EntityId, MutableList<ClientEvent>>()
    private var logged = 0
    // The deal's own events, which GameEnvironment.restore does not keep: without them
    // the log would begin after the opening hands were drawn.
    init { if (dealt.isNotEmpty()) for (seat in seats) logs.getOrPut(seat.id) { mutableListOf() } += ClientEventTransformer.transform(dealt, seat.id) }

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

/**
 * Everything the engine knows, loaded once, before the first request is read.
 *
 * Built the way Argentum's own servers build theirs (game-server's GameBeansConfig,
 * gym-server's GymBeansConfig): the predefined tokens first, then every set in
 * MtgSetCatalog.all, oldest first. Tokens first because a card that makes a Treasure or
 * a Food finds the token by name, and an unregistered one mints nothing; a real card
 * that shares a token's name comes after it and wins.
 *
 * The registry keeps the last definition registered under a name, and upstream allows
 * one definition per name for everything but basic lands (MtgSetCatalogTest), so the
 * order decides nothing about the rules. It decides the art: a bare "Plains" wears the
 * newest set's until a deck can name its printing, and a reprint that makes tokens
 * makes its own set's. Set code and release date are stamped as game-server stamps
 * them, because MtgSet's documentation says sets stamp their own cards and they do not
 * (CardDiscovery returns them unstamped).
 */
private class Corpus(
    val registry: CardRegistry,
    /** Every printing the engine can put on a card: each definition's own, and each set's reprints. */
    val printings: PrintingRegistry,
    val sets: List<MtgSet>,
    /** What a deck may hold: every set's cards and basic lands. Not a token, not a back face, not a meld result. */
    val deckable: Set<String>,
    val loadMs: Long,
    val heapMb: Long,
)

private const val MB = 1024L * 1024L

private fun corpus(): Corpus {
    val started = System.nanoTime()
    val sets = MtgSetCatalog.all
    val registry = CardRegistry().apply {
        register(PredefinedTokens.allTokens)
        for (set in sets) {
            register(set.cards.stamped(set))
            register(set.basicLands)
            set.basicLandsFallback?.let { register(it.basicLands) }
        }
    }
    // A meld result is registered, so melding finds it, but never dealt from a deck: Argentum
    // keeps it out of every pool of cards a player can own (CardDefinition.meldResult), and
    // Scryfall lists it as a card of its own that a player could add in the editor.
    val deckable = sets.flatMapTo(HashSet()) { set -> set.cards.filterNot { it.meldResult }.map { it.name } + set.basicLands.map { it.name } }
    // As game-server builds its own: a default printing made from every registered
    // definition, which carries the set it was stamped with, then each set's reprint rows.
    // Built from the definitions already stamped above rather than stamping them again.
    val printings = PrintingRegistry().apply {
        for (name in registry.allCardNames()) registry.getCardsByName(name).forEach(::registerSynthesizedDefault)
        for (set in sets) register(set.printings)
    }
    val loadMs = (System.nanoTime() - started) / 1_000_000
    // One collection first, so the figure is what the corpus holds rather than what
    // loading it threw away.
    System.gc()
    val rt = Runtime.getRuntime()
    return Corpus(registry, printings, sets, deckable, loadMs, (rt.totalMemory() - rt.freeMemory()) / MB)
}

private fun List<CardDefinition>.stamped(set: MtgSet): List<CardDefinition> = map { card ->
    val withSet = if (card.setCode == null) card.copy(setCode = set.code) else card
    if (withSet.metadata.releaseDate == null && set.releaseDate != null) {
        withSet.copy(metadata = withSet.metadata.copy(releaseDate = set.releaseDate))
    } else {
        withSet
    }
}

/** One line of a deck as the wire sends it: a name, how many, and the printing if one was named. */
private class Line(val name: String, val count: Int?, val set: String?, val number: String?)

/**
 * A deck's lines, from any shape the wire allows: `{"Mountain": 14}`, `{"Mountain":
 * {"count": 14, "set": "hob", "number": "192"}}`, or a list of those when one name comes in
 * several printings. A count that is not a positive whole number is read as null, which a
 * caller refuses rather than guesses at.
 */
private fun readLines(o: JsonObject?): List<Line> = o?.entries?.flatMap { (name, v) ->
    if (v is JsonArray) v.map { lineOf(name, it) } else listOf(lineOf(name, v))
} ?: emptyList()

private fun lineOf(name: String, v: JsonElement): Line = when (v) {
    is JsonPrimitive -> Line(name, v.intOrNull?.takeIf { it > 0 }, null, null)
    is JsonObject -> Line(
        name,
        v["count"]?.jsonPrimitive?.intOrNull?.takeIf { it > 0 },
        v["set"]?.jsonPrimitive?.contentOrNull,
        v["number"]?.jsonPrimitive?.contentOrNull,
    )
    else -> Line(name, null, null, null)
}

/**
 * The name the engine knows a deck line by, or null when it knows no such card.
 *
 * The app sends names as Scryfall spells them, and most are the engine's exactly. A card with
 * two faces is "Front // Back" to Scryfall, and the engine knows it by its front; that is taken
 * only when every later part really is one of that card's faces, so a name glued together from
 * two unrelated cards is refused rather than dealt as the first of them. "X // X", the shape of
 * an art-series card, stays unknown: it is not a card a deck may hold, and the app sends a
 * reversible card by its single name. A token or a lone back face is not in `deckable`, so it
 * falls out here too, though the engine knows both.
 */
private fun resolveName(corpus: Corpus, name: String): String? {
    if (name in corpus.deckable) return name
    val parts = name.split(" // ")
    if (parts.size < 2) return null
    val front = parts.first()
    if (front !in corpus.deckable) return null
    val def = corpus.registry.getCard(front) ?: return null
    val faces = buildSet { def.backFace?.name?.let(::add); def.cardFaces.forEach { add(it.name) } }
    return front.takeIf { parts.drop(1).all { it != front && it in faces } }
}

/**
 * The printing a deck line names, kept only when the engine has that printing and it is this
 * card. Printing.name is a card's front, which is what the line resolved to, so a double-faced
 * card's pin is compared with its front and not with Scryfall's "Front // Back". Set codes are
 * upper case in Argentum and lower case in Scryfall; collector numbers are Scryfall's spelling
 * in both, "208s" and "★" included.
 */
private fun pinOf(corpus: Corpus, line: Line, card: String): PrintingRef? {
    val set = line.set ?: return null
    val number = line.number ?: return null
    return PrintingRef(set.uppercase(), number).takeIf { corpus.printings.getPrinting(it)?.name == card }
}

private fun newTable(corpus: Corpus, params: JsonObject): Table {
    val registry = corpus.registry
    val players = params["players"]?.jsonArray ?: throw Refused("\"players\" is required.")
    if (players.size < 2) throw Refused("A game needs at least two players.")
    val leftOutOfSideboards = mutableListOf<List<String>>()
    val printingsMissed = mutableListOf<List<String>>()
    val configs = players.mapIndexed { i, p ->
        val o = p.jsonObject
        val name = o["name"]?.jsonPrimitive?.contentOrNull ?: "Player ${i + 1}"
        val lines = readLines(o["deck"] as? JsonObject ?: throw Refused("$name has no deck."))
        lines.firstOrNull { it.count == null }?.let { throw Refused("$name's deck lists ${it.name} without a number of copies.") }
        val missing = lines.map { it.name }.distinct().filter { resolveName(corpus, it) == null }
        if (missing.isNotEmpty()) throw Refused("The engine does not know ${missing.size} of $name's cards: ${missing.joinToString(", ")}")
        // One entry per copy, under the name the engine knows, in the order the deck gave them:
        // the same list Deck.of built, so a seed deals the same game it did before.
        // Each copy carries the printing the deck named, when the engine has it, so the deal
        // stamps that printing's art on the card; otherwise the card wears the engine's own.
        val entries = lines.flatMap { l -> resolveName(corpus, l.name)!!.let { card -> List(l.count!!) { CardEntry(card, pinOf(corpus, l, card)) } } }
        // The cards the player owns outside the game, which only a wish reaches (Argentum's
        // Deck.sideboard, citing CR 100.4). One the engine does not know is left out rather than
        // refused, as the owner chose on 2026-09-21: a whole game is too much to refuse over a
        // card only a wish could fetch. The reply names it, so the table can say so.
        val side = readLines(o["sideboard"] as? JsonObject)
        side.firstOrNull { it.count == null }?.let { throw Refused("$name's sideboard lists ${it.name} without a number of copies.") }
        val (sideKnown, sideUnknown) = side.partition { resolveName(corpus, it.name) != null }
        leftOutOfSideboards += sideUnknown.map { it.name }.distinct()
        val sideboard = sideKnown.flatMap { l -> resolveName(corpus, l.name)!!.let { card -> List(l.count!!) { CardEntry(card, pinOf(corpus, l, card)) } } }
        // A printing named but not held: said once per card, so the table can say whose art it wears.
        printingsMissed += (lines + sideKnown)
            .filter { it.set != null && it.number != null }
            .mapNotNull { l -> resolveName(corpus, l.name)?.takeIf { pinOf(corpus, l, it) == null } }
            .distinct()
        PlayerConfig(name = name, deck = Deck.fromEntries(entries, sideboard = sideboard), startingLife = o["life"]?.jsonPrimitive?.int ?: 20)
    }
    // The seed decides the shuffle, every coin flip and every other "at random",
    // so the same seed plays the same game. One is always chosen here and sent
    // back, which means any game, a failing test's included, can be played again
    // exactly. A chosen one stays below 2^53, because the relay reads it as a
    // JavaScript number and a larger Long would come back as a different game.
    val seed = params["seed"]?.jsonPrimitive?.longOrNull ?: (Random().nextLong() ushr 11)
    val env = GameEnvironment.create(registry)
    // Dealt here, not by env.reset: reset builds its GameInitializer without a printing
    // registry, so every card would wear the default art whatever printing the deck named.
    // restore installs the deal and drops its events, which the Table keeps for the log.
    val dealt = GameInitializer(registry, corpus.printings).initializeGame(GameConfig(
        players = configs,
        skipMulligans = params["skipMulligans"]?.jsonPrimitive?.boolean ?: true,
        startingPlayerIndex = params["startingPlayer"]?.jsonPrimitive?.int ?: 0,
        seed = seed,
    ))
    env.restore(dealt.state, dealt.playerIds)
    val seats = env.playerIds.mapIndexed { i, id ->
        val o = players[i].jsonObject
        Seat(id, configs[i].name, o["ai"]?.jsonPrimitive?.contentOrNull, o["autoPass"]?.jsonPrimitive?.boolean ?: false, leftOutOfSideboards[i], printingsMissed[i])
    }
    return Table(registry, env, seats, seed, dealt.events)
}

private fun seatsOf(table: Table): JsonArray = buildJsonArray {
    table.seats.forEach { s ->
        add(buildJsonObject {
            put("id", s.id.value); put("name", s.name); put("ai", s.ai); put("autoPass", s.autoPass)
            putJsonArray("sideboardLeftOut") { s.sideboardLeftOut.forEach { add(JsonPrimitive(it)) } }
            putJsonArray("unknownPrintings") { s.unknownPrintings.forEach { add(JsonPrimitive(it)) } }
        })
    }
}

fun main() {
    val corpus = corpus()
    var table: Table? = null
    val out = System.out.bufferedWriter()
    // UTF-8 both ways, whatever the machine's default: a deck arrives with names such as
    // "Déjà Vu", and a JAVA_TOOL_OPTIONS setting file.encoding must not garble them.
    val input = System.`in`.bufferedReader(Charsets.UTF_8)

    fun reply(id: JsonElement?, body: JsonObject) {
        val line = JsonObject(mapOf("id" to (id ?: JsonNull)) + body)
        out.write(json.encodeToString(JsonObject.serializer(), line)); out.write("\n"); out.flush()
    }

    while (true) {
        val line = input.readLine() ?: break
        if (line.isBlank()) continue
        val req = try { json.parseToJsonElement(line).jsonObject } catch (e: Exception) {
            reply(null, buildJsonObject { put("ok", false); put("error", "Not a JSON object: ${e.message}") }); continue
        }
        val id = req["id"]
        val body: JsonObject = try {
            when (val op = req["op"]?.jsonPrimitive?.contentOrNull) {
                "hello" -> buildJsonObject {
                    put("ok", true); put("engine", "argentum"); put("protocol", PROTOCOL)
                    // The names a deck may hold, which is what a player means by "cards".
                    put("cards", corpus.deckable.size)
                    // In release order, with whether Argentum marks a set incomplete, so the
                    // app can say what the engine lacks rather than only which card.
                    putJsonArray("sets") {
                        corpus.sets.forEach { s ->
                            add(buildJsonObject {
                                put("code", s.code); put("name", s.displayName); put("released", s.releaseDate); put("incomplete", s.incomplete)
                            })
                        }
                    }
                    // Measured, not assumed: what loading the corpus took and holds.
                    putJsonObject("load") {
                        put("ms", corpus.loadMs); put("heapMb", corpus.heapMb); put("maxHeapMb", Runtime.getRuntime().maxMemory() / MB)
                    }
                }
                "cards" -> buildJsonObject {
                    put("ok", true)
                    putJsonArray("names") { corpus.deckable.sorted().forEach { add(JsonPrimitive(it)) } }
                }
                // Which of a deck's cards the engine knows, asked before a game exists. The unknown
                // names come back exactly as they were sent, so the app can point at its own lines.
                "check" -> {
                    val lines = readLines(req["deck"] as? JsonObject ?: throw Refused("\"deck\" is required."))
                    val side = readLines(req["sideboard"] as? JsonObject)
                    val unknown = { ls: List<Line> -> ls.map { it.name }.distinct().filter { resolveName(corpus, it) == null }.sorted() }
                    buildJsonObject {
                        put("ok", true)
                        put("known", lines.filter { resolveName(corpus, it.name) != null }.sumOf { it.count ?: 0 })
                        put("total", lines.sumOf { it.count ?: 0 })
                        putJsonArray("unknown") { unknown(lines).forEach { add(JsonPrimitive(it)) } }
                        putJsonArray("unknownSideboard") { unknown(side).forEach { add(JsonPrimitive(it)) } }
                    }
                }
                "new" -> {
                    val t = newTable(corpus, req)
                    table = t
                    t.drive()
                    JsonObject(t.status() + mapOf("seats" to seatsOf(t), "seed" to JsonPrimitive(t.seed)))
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
