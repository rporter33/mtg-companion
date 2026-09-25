package companion

import com.wingedsheep.ai.engine.AIPlayer
import com.wingedsheep.ai.engine.AiProfile
import com.wingedsheep.ai.engine.EngineAiPlayerController
import com.wingedsheep.ai.llm.BottomCardsInfo
import com.wingedsheep.ai.llm.CardSummary
import com.wingedsheep.ai.llm.MulliganInfo
import com.wingedsheep.engine.core.ActivateAbility
import com.wingedsheep.engine.core.BatchYesNoDecision
import com.wingedsheep.engine.core.BatchYesNoResponse
import com.wingedsheep.engine.core.BottomCards
import com.wingedsheep.engine.core.CardsDiscardedEvent
import com.wingedsheep.engine.core.CardsDrawnEvent
import com.wingedsheep.engine.core.CardsSelectedResponse
import com.wingedsheep.engine.core.CastSpell
import com.wingedsheep.engine.core.ChooseColorDecision
import com.wingedsheep.engine.core.ChooseModeDecision
import com.wingedsheep.engine.core.ChooseNumberDecision
import com.wingedsheep.engine.core.ChooseOptionDecision
import com.wingedsheep.engine.core.ColorChosenResponse
import com.wingedsheep.engine.core.CombatResolutionDecision
import com.wingedsheep.engine.core.CombatResolutionResponse
import com.wingedsheep.engine.core.DamageEdgeAmount
import com.wingedsheep.engine.core.DeclareAttackers
import com.wingedsheep.engine.core.DeclareBlockers
import com.wingedsheep.engine.core.ChooseTargetsDecision
import com.wingedsheep.engine.core.DecisionResponse
import com.wingedsheep.engine.core.DistributeDecision
import com.wingedsheep.engine.core.DistributionResponse
import com.wingedsheep.engine.core.GameAction
import com.wingedsheep.engine.core.GameConfig
import com.wingedsheep.engine.core.GameEvent
import com.wingedsheep.engine.core.GameInitializer
import com.wingedsheep.engine.core.KeepHand
import com.wingedsheep.engine.core.LibraryShuffledEvent
import com.wingedsheep.engine.core.ManaSourcesSelectedResponse
import com.wingedsheep.engine.core.ModesChosenResponse
import com.wingedsheep.engine.core.MoveCollectionOrderContinuation
import com.wingedsheep.engine.core.NumberChosenResponse
import com.wingedsheep.engine.core.OptionChosenResponse
import com.wingedsheep.engine.core.OrderObjectsDecision
import com.wingedsheep.engine.core.OrderedResponse
import com.wingedsheep.engine.core.PendingDecision
import com.wingedsheep.engine.core.PlayLand
import com.wingedsheep.engine.core.PlayerConfig
import com.wingedsheep.engine.core.ReorderLibraryDecision
import com.wingedsheep.engine.core.SearchCardInfo
import com.wingedsheep.engine.core.SelectCardsDecision
import com.wingedsheep.engine.core.SelectManaSourcesDecision
import com.wingedsheep.engine.core.ShuffleCause
import com.wingedsheep.engine.core.StepChangedEvent
import com.wingedsheep.engine.core.SubmitDecision
import com.wingedsheep.engine.core.Suspension
import com.wingedsheep.engine.core.TakeMulligan
import com.wingedsheep.engine.core.TargetsResponse
import com.wingedsheep.engine.core.TurnChangedEvent
import com.wingedsheep.engine.core.YesNoDecision
import com.wingedsheep.engine.core.YesNoResponse
import com.wingedsheep.engine.core.ZoneChangeEvent
import com.wingedsheep.engine.handlers.MulliganHandler
import com.wingedsheep.engine.handlers.continuations.entityIdToChosenTarget
import com.wingedsheep.engine.legalactions.AdditionalCostData
import com.wingedsheep.engine.legalactions.LegalAction
import com.wingedsheep.engine.legalactions.MeaningfulActionFilter
import com.wingedsheep.engine.legalactions.TargetInfo
import com.wingedsheep.engine.state.components.identity.CardComponent
import com.wingedsheep.engine.state.components.player.MulliganStateComponent
import com.wingedsheep.engine.state.components.stack.ChosenTarget
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
import com.wingedsheep.sdk.core.Color
import com.wingedsheep.sdk.core.Step
import com.wingedsheep.sdk.core.Zone
import com.wingedsheep.sdk.model.CardDefinition
import com.wingedsheep.sdk.model.MtgSet
import com.wingedsheep.sdk.model.CardEntry
import com.wingedsheep.sdk.model.Deck
import com.wingedsheep.sdk.model.EntityId
import com.wingedsheep.sdk.model.PrintingRef
import com.wingedsheep.sdk.scripting.AdditionalCostPayment
import com.wingedsheep.sdk.scripting.effects.ZonePlacement
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
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
 *    second client. A heuristic seat plays at one of three levels, each one
 *    of Argentum's own named AI profiles (`LEVELS` below says which, and why).
 *  - **Decisions the client cannot answer are answered here, and said.**
 *    Targets, yes/no and option choices always go to the client. The rest go
 *    to a client that said it can put them on screen (`answers` on a player in
 *    `new`, protocol 5): cards to select, an order, a division, combat damage,
 *    mana sources, a number, a colour, modes, and a yes or no for several at
 *    once. Anything else — and all of those for a client that did not say — is
 *    answered by the engine's own responder and reported under `decided`, so
 *    the table can show what was done on the player's behalf rather than hide it.
 *  - **A play is chosen whole before it is sent.** `act` carries the targets,
 *    the X, the division of damage and the cost's choices a person made at the
 *    table, which is how Argentum's own client sends a cast (a `CastSpell` or
 *    `ActivateAbility` with them filled in); an offer sent bare is refused where
 *    it needed any of them.
 *  - **The opening hands are the players' to keep, where asked for.** Argentum's
 *    mulligan phase is not a priority window, and its legal actions know nothing
 *    of it; its own game server drives it beside the priority loop, and so does
 *    this (`mulliganing`): a person is offered keeping, a mulligan and then the
 *    cards to put on the bottom, and the engine's seat answers by Argentum's own
 *    mulligan responder, the one its game server plays with.
 *  - **What is worth watching is Law 1's question turned around.** A paced
 *    table stops after each of the engine's own plays so they can be seen
 *    happening, but not after a priority pass or a mana ability: the same
 *    `MeaningfulActionFilter` answers both.
 */
// 2: a deck line may name its printing, {"count","set","number"} or a list of those, and
// the deal honours it. An engine at 1 reads only counts, so the relay sends it only counts.
// 3: a table may be paced. "new" takes "pace", after which the table stops as soon as the
// engine's own seat has taken one action worth watching — waiting "engine" — and "continue"
// takes the next step; and a delta view's log carries only its seat's new lines. An
// engine at 2 has neither: it would ignore "pace" and refuse "continue" as an unknown op, so
// a relay that reads protocol 2 must not ask for a pace.
// 4: an engine's seat may be asked to play at a level — "level" on a player in "new", one of
// the words in `LEVELS` — and the reply's seats say the level and the Argentum profile each one
// plays with, so a relay can see what was taken rather than assume it. "hello" lists the levels.
// An engine at 3 ignores "level", as it ignores every key it does not know, and plays its one
// way (Argentum's CURRENT profile), so a relay reading 3 must not ask for one and must not say
// the engine is playing at one. "clock" is new here too, for measuring what a level costs.
// 5: a person chooses. "act" takes a play's targets, its X, its division of damage and what its
// cost takes ("targets", "x", "damage", "cost"), or "auto" to have the engine choose them; an
// offer says what it needs chosen ("targetRequirements", "x", "divide", "costChoice"). A player
// in "new" may carry "answers", the decisions its client can put on screen, and those are asked
// rather than answered for it; the reply's seat says which it will be asked ("asked"). "decide"
// takes each of their answers. "hello" says all of this as "choices". An engine at 4 ignores
// every one of those keys, so a relay reading 4 sends none of them and must not tell a client
// that a target it chose will reach the engine: it would be dropped, and the cast refused.
// 6: a game may open with mulligans. "new" takes "mulligans": true, and the table then opens in
// Argentum's own mulligan phase (the London mulligan, CR 103.5): a person is offered "KeepHand" and
// "TakeMulligan", and once they keep with mulligans taken, "BottomCards", whose "act" carries the
// cards chosen ("cards"); the engine's seat decides by Argentum's own mulligan responder. The reply
// says "mulligans": true where the phase was dealt. An engine at 5 ignores the key and deals every
// hand kept, as every engine before it did, so a relay reading 5 must not ask for one.
const val PROTOCOL = 6

/**
 * The decisions put to a person whatever their client said, because every client since the
 * first could answer them: targets, a yes or no, one option of several.
 */
private val ALWAYS_ASKED = setOf("ChooseTargets", "YesNo", "ChooseOption")

/**
 * The decisions this process can put to a person as well, when their client says it can show
 * them (HANDOFF.md, M4). Each is Argentum's own class, named without its "Decision", and each is
 * answered in `decide` with the response Argentum's own validator expects of it.
 *
 * Not here, so still answered by the engine's responder and reported under `decided`: splitting
 * cards into piles, choosing a word to replace, a budget of modes, and the two Argentum no longer
 * raises at the pin — `AssignDamageDecision`, which its combat now asks as one
 * `CombatResolutionDecision` for the whole step, and `SearchLibraryDecision`.
 */
private val ASKABLE = ALWAYS_ASKED + setOf(
    "SelectCards", "OrderObjects", "ReorderLibrary", "Distribute", "CombatResolution",
    "SelectManaSources", "ChooseNumber", "ChooseColor", "ChooseMode", "BatchYesNo",
)

/** A decision's kind as the wire names it: Argentum's class name without "Decision". */
private fun PendingDecision.kind(): String = this::class.simpleName?.removeSuffix("Decision") ?: "Unknown"

/**
 * The costs `act` can pay with what a person chose, by Argentum's own `costType`, and the field of
 * Argentum's `AdditionalCostPayment` each one fills — the same mapping Argentum's own client and
 * AI use (web-client `pipelinePhases.ts`, `Strategist.withAutomaticPayments`). Any other kind of
 * cost that needs a choice is still one the table holds back and says so.
 */
private val PAYABLE: Map<String, (AdditionalCostPayment, List<EntityId>) -> AdditionalCostPayment> = mapOf(
    "DiscardCard" to { p, ids -> p.copy(discardedCards = ids) },
    "SacrificePermanent" to { p, ids -> p.copy(sacrificedPermanents = ids) },
    "TapPermanents" to { p, ids -> p.copy(tappedPermanents = ids) },
    "BouncePermanent" to { p, ids -> p.copy(bouncedPermanents = ids) },
    "ExileFromGraveyard" to { p, ids -> p.copy(exiledCards = ids) },
    "ExileFromHand" to { p, ids -> p.copy(exiledCards = ids) },
    "Behold" to { p, ids -> p.copy(beheldCards = ids) },
    "RevealCard" to { p, ids -> p.copy(revealedCards = ids) },
    "Blight" to { p, ids -> p.copy(blightTargets = ids) },
)

/**
 * What `act` takes beyond the index, said in `hello` so a relay can tell its clients. `cards` is
 * the cards a person puts on the bottom after a mulligan (protocol 6).
 */
private val ACT_TAKES = listOf("targets", "x", "damage", "cost", "auto", "cards")

/** The offers of the mulligan phase, by Argentum's own names for the actions (GameAction.kt). */
private val MULLIGAN_OFFERS = setOf("KeepHand", "TakeMulligan", "BottomCards")

/**
 * The three strengths the app offers, each one of Argentum's own named profiles
 * (`ai/…/engine/AiProfile.kt` at the pinned commit), chosen and measured for M3
 * (docs/table-rebuild/PLAN.md, "M3: easy, intermediate, hard"). Nothing here tunes a
 * profile: a level is only ever a name for one Argentum already publishes numbers about.
 *
 *  - **easy** is `LEGACY_V0`, the greedy one-move look Argentum keeps frozen as the reference
 *    every one of its arena results is quoted against. It is the same player every engine
 *    before protocol 4 fielded (`CURRENT` is `LEGACY_V0` under another id), so easy is exactly
 *    the engine this table played before there were levels.
 *  - **hard** is `PRODUCTION_CANDIDATE_EXPIRING`, the profile Argentum's own game server
 *    (`EngineAiPlayerController`) plays its players with at the pinned commit: rollouts on a
 *    four-tier budget, hidden cards guessed rather than read, and every evaluation fix that
 *    has been promoted since.
 *  - **intermediate** is `PRODUCTION_RACECLOCK`: Argentum's `PRODUCTION` (card knowledge and
 *    the card advisors) plus the discounted race clock, the one evaluator fix Argentum's arena
 *    measured as a strength gain on its own without rollouts. It answers as fast as easy does,
 *    because it still looks one move ahead.
 *
 * What each one measured against the others, through this process, is in PLAN.md.
 */
private val LEVELS: Map<String, AiProfile> = linkedMapOf(
    "easy" to AiProfile.LEGACY_V0,
    "intermediate" to AiProfile.PRODUCTION_RACECLOCK,
    "hard" to AiProfile.PRODUCTION_CANDIDATE_EXPIRING,
)

/**
 * Argentum's named profiles, by their own ids, for a measurement that wants to set one against
 * another (`scripts/engine-levels.mjs`): the candidates each level was chosen from, and the
 * steps between them. The relay never sends a profile; it sends a level. A profile asked for by
 * an id not here is refused, so a measurement never quietly plays a different agent.
 */
private val PROFILES: Map<String, AiProfile> = listOf(
    AiProfile.LEGACY_V0,
    AiProfile.CURRENT,
    AiProfile.PRODUCTION,
    AiProfile.PRODUCTION_RACECLOCK,
    AiProfile.PRODUCTION_TUNED,
    AiProfile.PRODUCTION_CANDIDATE,
    AiProfile.PRODUCTION_CANDIDATE_TUNED,
    AiProfile.PRODUCTION_CANDIDATE_COUNTERPATIENCE,
    AiProfile.PRODUCTION_CANDIDATE_EXPIRING,
    AiProfile.PHASE7,
    AiProfile.PHASE8,
).associateBy { it.id }

private val json = Json { encodeDefaults = false; ignoreUnknownKeys = true }

private class Seat(
    val id: EntityId,
    val name: String,
    val ai: String?,
    val autoPass: Boolean,
    val sideboardLeftOut: List<String> = emptyList(),
    /** Cards whose chosen printing the engine does not have, so they wear its own art. */
    val unknownPrintings: List<String> = emptyList(),
    /** The Argentum profile a heuristic seat plays with; null for a person and for a random seat. */
    val profile: AiProfile? = null,
    /** The level that profile was asked for by, when it was asked for by one this engine has. */
    val level: String? = null,
    /**
     * The decisions put to this seat's person rather than answered for them: the ones every client
     * answers, and those of `ASKABLE` their client said it can show. Empty for an engine's seat.
     */
    val asks: Set<String> = ALWAYS_ASKED,
) {
    /** Whether this decision is put to the person in this seat, rather than answered here. */
    fun asked(d: PendingDecision): Boolean = ai == null && d.kind() in asks
}

/**
 * How long one of an engine seat's choices took, for `clock`. `meaningful` says whether there
 * was anything to choose between — an affordable play the engine itself calls worth making —
 * because most windows offer only a pass, and a median taken over those says nothing about a
 * level. A decision the seat answered for itself is always a choice.
 */
private class Choice(val nanos: Long, val decision: Boolean, val meaningful: Boolean)

/** Zones whose contents only their owner may know. */
private val HIDDEN = setOf(Zone.HAND, Zone.LIBRARY)

/**
 * The engine's events as one seat's log.
 *
 * Argentum phrases every zone change by the card's name, whoever is looking,
 * so on its own a card drawn is said twice (the draw, then the move into hand)
 * and a card moving between another seat's library and hand is named to a seat
 * that must not know it: the opponent's opening hand, card by card, as found in
 * M1's run in a browser. A move between hidden zones is left out of every log
 * but its owner's, and a draw or discard is said once, by its own event. Taps,
 * untaps and mana are left out as Argentum's own game server leaves them out
 * (`GameSession`, "filter noisy events").
 *
 * Each line also says the step it happened in, which Argentum's lines do not:
 * a view arrives only where somebody stops, so without it the table filed the
 * engine's draw under its upkeep. `from` is the step the game stood in before
 * these events; a new turn has none until its first step begins.
 *
 * A mulligan (CR 103.5; protocol 6) is a hand shuffled back and seven drawn
 * again. Argentum says the first part as a move of each card into the library,
 * a line a card, which reads as seven cards put away one by one; the hand going
 * back is said once instead, by its shuffle, as the mulligan it is. A card put
 * on the bottom after keeping is said as that to its owner (`bottomed`, by its
 * place in `events`), where Argentum says only that it went to the library; to
 * anybody else it is a move between hidden zones, and left out as those are.
 */
private fun logLines(events: List<GameEvent>, viewer: EntityId, from: Step?, bottomed: (Int) -> Boolean = { false }): List<LogLine> {
    val drawn = events.filterIsInstance<CardsDrawnEvent>().flatMapTo(HashSet()) { it.cardIds }
    val discarded = events.filterIsInstance<CardsDiscardedEvent>().flatMapTo(HashSet()) { it.cardIds }
    // The hand's cards going back for a mulligan: the moves from hand to library just before its shuffle.
    val shuffledBack = HashSet<Int>()
    events.forEachIndexed { i, e ->
        if (e is LibraryShuffledEvent && e.cause == ShuffleCause.MULLIGAN) {
            var j = i - 1
            while (j >= 0 && (events[j] as? ZoneChangeEvent)?.let { it.ownerId == e.playerId && it.fromZone == Zone.HAND && it.toZone == Zone.LIBRARY } == true) shuffledBack += j--
        }
    }
    var step = from
    val out = mutableListOf<LogLine>()
    for ((i, e) in events.withIndex()) {
        when (e) {
            is StepChangedEvent -> { step = e.newStep; continue }
            is TurnChangedEvent -> step = null
            is LibraryShuffledEvent -> if (e.cause == ShuffleCause.MULLIGAN) {
                val yours = e.playerId == viewer
                out += LogLine(ClientEvent.LibraryShuffled(e.playerId, yours, if (yours) "You took a mulligan" else "Opponent took a mulligan"), step)
                continue
            }
            is ZoneChangeEvent -> {
                if (i in shuffledBack) continue
                if (bottomed(i) && e.ownerId == viewer && e.fromZone == Zone.HAND && e.toZone == Zone.LIBRARY) {
                    out += LogLine(ClientEvent.PermanentLeft(e.entityId, e.entityName, "library", e.ownerId, true, "You put ${e.entityName} on the bottom of your library"), step)
                    continue
                }
                if (
                    (e.fromZone == Zone.LIBRARY && e.toZone == Zone.HAND && e.entityId in drawn) ||
                    (e.fromZone == Zone.HAND && e.toZone == Zone.GRAVEYARD && e.entityId in discarded) ||
                    (e.ownerId != viewer && e.toZone in HIDDEN && (e.fromZone == null || e.fromZone in HIDDEN))
                ) continue
            }
            else -> {}
        }
        for (line in ClientEventTransformer.transform(listOf(e), viewer)) {
            if (line is ClientEvent.PermanentTapped || line is ClientEvent.PermanentUntapped || line is ClientEvent.ManaAdded) continue
            out += LogLine(line, step)
        }
    }
    return out
}

/** A line of one seat's log, and the step it happened in, if the game had begun one. */
private class LogLine(val event: ClientEvent, val step: Step?)

private class Table(
    val registry: CardRegistry,
    val env: GameEnvironment,
    val seats: List<Seat>,
    val seed: Long,
    /** Whether this table stops between the engine's own actions, so they can be watched. */
    val paced: Boolean,
    dealt: List<GameEvent> = emptyList(),
    /** Whether the game was dealt with a mulligan phase (protocol 6), rather than every hand kept. */
    val opening: Boolean = false,
) {
    val transformer = ClientStateTransformer(registry)
    val lastView = HashMap<EntityId, ClientGameState>()
    /** How much of each seat's log it has been sent, so a delta carries only what is new. */
    val sentLines = HashMap<EntityId, Int>()
    /** What each seat has been told happened, in its own words: the game log. */
    val logs = HashMap<EntityId, MutableList<LogLine>>()
    private var logged = 0
    /** The step the game stood in at the last event recorded, carried from one batch to the next. */
    private var step: Step? = null
    /** Where in `env.events` cards were put on the bottom after a mulligan, so the log can say so. */
    private val bottomed = HashSet<Int>()
    // The deal's own events, which GameEnvironment.restore does not keep: without them
    // the log would begin after the opening hands were drawn.
    init { if (dealt.isNotEmpty()) for (seat in seats) logs.getOrPut(seat.id) { mutableListOf() } += logLines(dealt, seat.id, null) }

    /** Carries the engine's events since the last call into every seat's log, masked for that seat. */
    fun record() {
        val from = logged
        val fresh = env.events.drop(from)
        logged = env.events.size
        if (fresh.isEmpty()) return
        for (seat in seats) logs.getOrPut(seat.id) { mutableListOf() } += logLines(fresh, seat.id, step) { i -> (from + i) in bottomed }
        for (e in fresh) if (e is StepChangedEvent) step = e.newStep else if (e is TurnChangedEvent) step = null
    }

    /** Takes an action, noting where the cards it put on the bottom after a mulligan fall in the log. */
    private fun take(action: GameAction) {
        val before = env.events.size
        env.step(action)
        if (action is BottomCards) bottomed += before until env.events.size
    }

    /** Argentum's own account of the mulligan phase, asked each time and never kept here. */
    private val mulliganPhase = MulliganHandler(registry)

    /**
     * The seat the mulligan phase is waiting on, or null when there is none — the game dealt with
     * every hand kept, or the phase over. In Argentum's own order (`MulliganHandler`): the first in
     * turn order still to keep or take a mulligan, and once every hand is kept, the first still to
     * put cards on the bottom.
     */
    fun mulliganing(): EntityId? {
        val s = env.state
        if (s.gameOver) return null
        return when {
            mulliganPhase.isInMulliganPhase(s) -> mulliganPhase.getNextMulliganPlayer(s)
            mulliganPhase.needsBottomCards(s) -> mulliganPhase.getNextBottomCardsPlayer(s)
            else -> null
        }
    }

    /** Who the table is waiting on: the mulligan phase's seat while it lasts, else whoever has priority or a decision. */
    fun waitingOn(): EntityId? = mulliganing() ?: env.agentToAct

    private fun mulliganStateOf(id: EntityId): MulliganStateComponent =
        env.state.getEntity(id)?.get<MulliganStateComponent>() ?: MulliganStateComponent()

    /**
     * The mulligan phase's offers to a person, in the shape every offer has, as Argentum's own
     * actions: keep this hand, or take a mulligan while one may still be taken; and once kept with
     * mulligans taken, put that many on the bottom.
     */
    private fun mulliganOffers(id: EntityId): List<LegalAction> {
        val m = mulliganStateOf(id)
        if (m.hasKept) {
            val n = m.cardsToBottom
            return listOf(LegalAction(BottomCards(id, emptyList()), "BottomCards", "Put $n ${if (n == 1) "card" else "cards"} on the bottom of your library"))
        }
        return listOfNotNull(
            LegalAction(KeepHand(id), "KeepHand", "Keep this hand"),
            LegalAction(TakeMulligan(id), "TakeMulligan", "Take a mulligan").takeIf { m.canMulligan },
        )
    }

    /**
     * A card in hand as Argentum's mulligan responder reads one, built as its game server builds
     * it (`GameSession.mulliganCardInfo`): the responder counts lands by the type line and weighs
     * spells by their cost.
     */
    private fun summaryOf(id: EntityId): CardSummary {
        val c = env.state.getEntity(id)?.get<CardComponent>()
        return CardSummary(
            name = c?.name ?: "Unknown", manaCost = c?.manaCost?.toString(), typeLine = c?.typeLine?.toString(),
            power = c?.baseStats?.basePower, toughness = c?.baseStats?.baseToughness, oracleText = c?.oracleText?.takeIf { it.isNotBlank() },
        )
    }

    /**
     * Argentum's own mulligan responder for a seat: `EngineAiPlayerController`, which is what its game
     * server asks for the engine's keep, its mulligan and the cards it bottoms. The levels choose
     * plays, and none of them has a mulligan of its own, so every level mulligans alike.
     */
    private fun mulliganResponder(id: EntityId) = EngineAiPlayerController(registry, id, { env.state })

    /**
     * The cards Argentum's mulligan responder puts on the bottom for a seat: for the engine's own,
     * and for a person who asks the engine to choose. It can come up short — it bottoms spare lands
     * and dear spells, and a hand of few of either has fewer than asked for — and `BottomCards` takes
     * exactly as many as are owed, so the rest are taken in the order of the hand.
     */
    private fun bottomFor(id: EntityId): List<EntityId> {
        val owed = mulliganStateOf(id).cardsToBottom
        val hand = env.state.getHand(id)
        val chosen = mulliganResponder(id).chooseBottomCards(BottomCardsInfo(hand, owed, hand.associateWith(::summaryOf))).filter { it in hand }.distinct()
        return (chosen + hand.filterNot { it in chosen }).take(owed)
    }

    /** What the engine's seat does in the mulligan phase, decided by Argentum's own responder. */
    private fun engineMulligan(id: EntityId): GameAction {
        val m = mulliganStateOf(id)
        if (m.hasKept) return BottomCards(id, bottomFor(id))
        val hand = env.state.getHand(id)
        val keep = !m.canMulligan || mulliganResponder(id).decideMulligan(MulliganInfo(
            hand = hand, mulliganCount = m.mulligansTaken, cardsToPutOnBottom = m.cardsToBottom,
            cards = hand.associateWith(::summaryOf), isOnThePlay = env.state.activePlayerId == id,
        ))
        return if (keep) KeepHand(id) else TakeMulligan(id)
    }
    val players = HashMap<EntityId, AIPlayer>()
    val randoms = HashMap<EntityId, RandomActionSelector>()

    /** What was last offered to a human seat, so `act` can name an action by index. */
    var offered: List<LegalAction> = emptyList()
    var offeredTo: EntityId? = null

    /**
     * On a paced table, the engine's seat that took the action the table stopped after;
     * null when the table is waiting on a player, or on nothing at all. It is what
     * `continue` acts on and what makes the status say it is waiting on the engine.
     */
    var pausedAfter: EntityId? = null

    /** What happened on the way to the current stop, reported once and cleared. */
    var autoPassed = 0
    val decided = mutableListOf<JsonObject>()

    fun seat(id: EntityId): Seat = seats.first { it.id == id }

    /**
     * The engine's player for a seat. A heuristic seat's is its level's profile; every other
     * seat's — a person's, whose decisions this protocol cannot yet ask and so answers for them,
     * and a random seat's — is `CURRENT`, the responder every engine before levels used.
     */
    fun player(id: EntityId): AIPlayer = players.getOrPut(id) { AIPlayer.create(registry, id, seat(id).profile ?: AiProfile.CURRENT) }

    /** Every choice each engine seat made since the last `clock`, and how long it took. */
    val clock = HashMap<EntityId, MutableList<Choice>>()
    private inline fun <T> timed(id: EntityId, decision: Boolean, meaningful: Boolean, choose: () -> T): T {
        val started = System.nanoTime()
        val chosen = choose()
        clock.getOrPut(id) { mutableListOf() } += Choice(System.nanoTime() - started, decision, meaningful)
        return chosen
    }

    /**
     * Runs the table forward until a human seat has to act, the game ends, or
     * nothing more can happen. AI seats play themselves; a human seat with
     * autoPass is passed for when it has nothing affordable (Law 1); a
     * decision a human cannot answer over this protocol is answered by the
     * engine's responder and noted.
     *
     * A paced table stops sooner: as soon as the engine's seat has taken one
     * action worth watching. Without that, a whole turn of the engine's arrives
     * as one jump and there is nothing to see happen (HANDOFF.md, M2). The
     * stopping is all that changes — the same seed plays the same game either
     * way, because the same actions are chosen in the same order by the same
     * players — and the waiting itself belongs to the relay, which asks for
     * `continue` at the room's pace.
     */
    fun drive() {
        var guard = 0
        offered = emptyList(); offeredTo = null
        pausedAfter = null
        // The engine's seat that has acted in this step, on a paced table.
        var acted: EntityId? = null
        while (!env.isTerminal && guard++ < 10_000) {
            // The opening hands come first (protocol 6). Argentum's mulligan phase is not a priority
            // window, and its legal actions know nothing of it: asked, they would offer the first
            // player a spell in the untap step. So it is driven here, beside the priority loop, as
            // Argentum's own game server drives it. The engine's seat decides at once, and is not a
            // stop of a paced table: it is part of the deal, and the log says what it did.
            val deciding = mulliganing()
            if (deciding != null) {
                if (seat(deciding).ai != null) {
                    take(engineMulligan(deciding))
                    // Never refused while Argentum's responder and its handlers agree; if they ever
                    // do not, the table says so rather than ask again ten thousand times.
                    env.lastRejection?.let { error("The engine's own mulligan was refused: $it") }
                    continue
                }
                offered = mulliganOffers(deciding); offeredTo = deciding
                return
            }
            val actor = env.agentToAct ?: return
            val seat = seat(actor)
            val decision = env.pendingDecision
            if (decision != null) {
                if (seat.asked(decision)) return
                // A decision answered here — the engine's own, or one this protocol cannot
                // put to a human — belongs to the action that raised it, so a paced table
                // does not stop for it: a step is one action and the answers it needed.
                val response = if (seat.ai == null) player(actor).respondToDecision(env.state, decision)
                    else timed(actor, decision = true, meaningful = true) { player(actor).respondToDecision(env.state, decision) }
                if (seat.ai == null) decided += describe(decision)
                env.step(SubmitDecision(actor, response))
                continue
            }
            val actions = env.legalActions()
            if (actions.isEmpty()) return
            // Where a paced table stops. It is here, before the next action of any kind,
            // rather than straight after the engine's own: what its action left to decide is
            // decided first, so what the relay publishes is that seat having finished its go.
            if (acted != null) { pausedAfter = acted; return }
            if (seat.ai != null) {
                val worthIt = actions.any { MeaningfulActionFilter.isMeaningful(it) && it.affordable }
                val chosen = timed(actor, decision = false, meaningful = worthIt) {
                    when (seat.ai) {
                        "random" -> randoms.getOrPut(actor) { RandomActionSelector(Random(actor.value.hashCode().toLong())) }
                            .selectAction(env.state, actions)
                        else -> player(actor).chooseFrom(env.state, actions).action
                    }
                }
                // Worth stopping to watch? The engine's own judgement, the same question Law 1
                // asks on the player's behalf a few lines below: a priority pass, a land tapped
                // for mana or a declaration of nothing shows nothing, and a pace waited out for
                // one would put "the engine is thinking" between every step of your own turn —
                // the engine passes in all of them. So a step is one action there is something
                // to see in, and a turn it does nothing in arrives whole, as it does today.
                if (paced && worthWatching(actions, chosen)) acted = actor
                env.step(chosen)
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
        val actor = waitingOn()
        // A paced table that has stopped after one of the engine's actions names the seat
        // that took it, not whoever has priority now: what there is to see is what that seat
        // did, and what the table is waiting for is the relay's next `continue`.
        val paused = pausedAfter.takeIf { !env.isTerminal }
        put("actor", (paused ?: actor)?.value)
        val decision = env.pendingDecision
        when {
            env.isTerminal -> put("waiting", JsonNull)
            paused != null -> put("waiting", "engine")
            actor != null && decision != null && seat(actor).asked(decision) -> {
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
        val lines = logs[viewer] ?: emptyList()
        // A full view carries the whole log and starts the count again; a delta carries only
        // the lines added since this seat's last view, which the client appends to the log it
        // already holds. A paced turn asks for a view every few hundred milliseconds, and the
        // whole log each time would soon be most of what the wire carried.
        val since = if (delta && prev != null) sentLines[viewer] ?: 0 else 0
        sentLines[viewer] = lines.size
        return buildJsonObject {
            put("ok", true)
            // The log, phrased for this seat. Most events work out their
            // `description` as a default, which encodeDefaults = false leaves off
            // the wire, and a line without one is a line the table cannot say: a
            // land played and the engine's whole turn went by in silence until
            // M1's run in a browser. So every line carries its words explicitly,
            // and the step it happened in.
            putJsonArray("log") {
                for (line in lines.drop(since)) {
                    val fields = json.encodeToJsonElement(ClientEvent.serializer(), line.event).jsonObject.toMutableMap()
                    fields["description"] = JsonPrimitive(line.event.description)
                    line.step?.let { fields["step"] = JsonPrimitive(it.name) }
                    add(JsonObject(fields))
                }
            }
            if (delta && prev != null) {
                put("delta", json.encodeToJsonElement(StateDelta.serializer(), StateDiffCalculator.computeDelta(prev, next)))
            } else {
                put("state", json.encodeToJsonElement(ClientGameState.serializer(), next))
            }
        }
    }

    /**
     * What each engine seat's choices have cost since the last time this was asked, in
     * milliseconds, and the record is started again. For measuring a level (PLAN.md, M3):
     * what a player waits on is the engine choosing, and this is that alone, without the
     * rules applying the choice or the wire carrying it.
     */
    fun readClock(): JsonObject = buildJsonObject {
        put("ok", true)
        putJsonArray("seats") {
            for (s in seats.filter { it.ai != null }) add(buildJsonObject {
                put("id", s.id.value); put("ai", s.ai); put("level", s.level); put("profile", s.profile?.id)
                putJsonArray("choices") {
                    clock[s.id].orEmpty().forEach { c ->
                        add(buildJsonObject {
                            // Tenths of a millisecond: finer is noise from the clock itself.
                            put("ms", (c.nanos / 100_000) / 10.0)
                            if (c.decision) put("decision", true)
                            put("meaningful", c.meaningful)
                        })
                    }
                }
            })
        }
        clock.clear()
    }

    fun act(index: Int, params: JsonObject): JsonObject {
        val actor = waitingOn() ?: throw Refused("The game is not waiting on anyone.")
        if (offeredTo != actor || offered.isEmpty()) throw Refused("No actions are on offer. Ask for the turn first.")
        val offer = offered.getOrNull(index) ?: throw Refused("No action $index; ${offered.size} were offered.")
        val auto = (params["auto"] as? JsonPrimitive)?.booleanOrNull == true
        val action = when (val a = offer.action) {
            // Keeping and taking a mulligan have nothing in them to choose. The cards put on the
            // bottom are the person's, or, asked to choose, Argentum's own mulligan responder's.
            is KeepHand, is TakeMulligan -> a
            is BottomCards -> BottomCards(actor, if (auto) bottomFor(actor) else bottomChosen(actor, params))
            // "Let the engine choose": the person's own responder — the one that answers what this
            // protocol cannot ask — fills in what the play needs, as it does for the engine's seat:
            // its X, its targets and what its cost takes (Argentum's Strategist, given this one offer).
            // It makes every one of those choices, and anything else sent with `auto` is not read:
            // the Strategist chooses a play whole, and a division of damage it chose for its own
            // targets would not fit targets the person chose.
            else -> if (auto) player(actor).chooseFrom(env.state, listOf(offer)).action else filledIn(offer, actor, params)
        }
        take(action)
        env.lastRejection?.let { throw Refused("The engine refused that: $it") }
        drive()
        return status()
    }

    /**
     * The cards a person chose to put on the bottom, checked here before Argentum sees them.
     * Argentum counts the ids and checks each is in hand, and no more: a card named twice passes
     * its count, moves once, and the mulligan is settled with a card still owed kept in hand (found
     * in M4's review). So each card may be named once, and as many as are owed, said in this
     * process's words; a card not in the hand is still Argentum's to refuse.
     */
    private fun bottomChosen(actor: EntityId, params: JsonObject): List<EntityId> {
        val owed = mulliganStateOf(actor).cardsToBottom
        val chosen = (params["cards"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }?.map(::EntityId)
            ?: throw Refused("Putting cards on the bottom needs \"cards\", the $owed chosen from your hand, or \"auto\": true.")
        if (chosen.distinct().size != chosen.size) throw Refused("Each card goes on the bottom once; the same card was named twice.")
        if (chosen.size != owed) throw Refused("Put exactly $owed on the bottom: ${chosen.size} ${if (chosen.size == 1) "was" else "were"} chosen.")
        return chosen
    }

    /**
     * An offer with what the person chose filled in. Combat declarations say which creatures, at
     * whom; left out, they declare nothing. A spell or an ability carries its targets, its X, its
     * division of damage and what its cost takes, which is how Argentum's own client sends one;
     * anything left out is left as the engine offered it, so an offer that needed nothing chosen
     * goes as it always has.
     */
    private fun filledIn(offer: LegalAction, actor: EntityId, params: JsonObject): GameAction = when (val a = offer.action) {
        is DeclareAttackers -> DeclareAttackers(actor, params["attackers"]?.jsonObject?.entries
            ?.associate { (k, v) -> EntityId(k) to EntityId(v.jsonPrimitive.content) } ?: emptyMap())
        is DeclareBlockers -> DeclareBlockers(actor, params["blockers"]?.jsonObject?.entries
            ?.associate { (k, v) -> EntityId(k) to v.jsonArray.map { EntityId(it.jsonPrimitive.content) } } ?: emptyMap())
        is CastSpell -> a.copy(
            targets = targetsOf(offer, params) ?: a.targets,
            xValue = (params["x"] as? JsonPrimitive)?.intOrNull ?: a.xValue,
            damageDistribution = amountsOf(params["damage"]) ?: a.damageDistribution,
            additionalCostPayment = paymentOf(offer, params, a.additionalCostPayment) ?: a.additionalCostPayment,
        )
        is ActivateAbility -> a.copy(
            targets = targetsOf(offer, params) ?: a.targets,
            xValue = (params["x"] as? JsonPrimitive)?.intOrNull ?: a.xValue,
            damageDistribution = amountsOf(params["damage"]) ?: a.damageDistribution,
            costPayment = paymentOf(offer, params, a.costPayment) ?: a.costPayment,
        )
        else -> a
    }

    /**
     * The targets chosen, requirement by requirement — `{"0": ["e12"], "1": ["e3", "e4"]}`, the
     * shape `decide` takes for a targets decision — as the one list Argentum's `CastSpell` and
     * `ActivateAbility` carry: every requirement's in order, each as the kind of target its object
     * is where it stands now (a player, a permanent, a spell on the stack, a card in a zone),
     * which is Argentum's own `entityIdToChosenTarget`.
     *
     * Argentum reads that list by position, each requirement's targets starting where the ones
     * before it could have ended (`TargetValidator.validateTargets`), and its own client sends it
     * flat all the same. So a requirement given fewer than it could take, with targets chosen for
     * a later one, would be read as something nobody chose — the later targets counted as the
     * earlier requirement's. That is refused here, in words, rather than sent. The offer's own
     * requirements are walked, not the keys sent, so a requirement left out altogether counts as
     * given none (found in M4's review: `{"1": [...]}` for an offer whose requirement 0 may take
     * none was sent flat and read as requirement 0's); and a key naming no requirement the offer
     * has is refused too, rather than its targets read as some other requirement's.
     */
    private fun targetsOf(offer: LegalAction, params: JsonObject): List<ChosenTarget>? {
        val chosen = params["targets"] as? JsonObject ?: return null
        val requirements = requirementsOf(offer)
        val known = requirements.map { it.index }.toSet()
        chosen.keys.firstOrNull { it.toIntOrNull() !in known }?.let { key ->
            throw Refused("This play has no target requirement \"$key\"; it has ${if (known.isEmpty()) "none" else known.sorted().joinToString(", ") { "\"$it\"" }}.")
        }
        val byRequirement = requirements.sortedBy { it.index }.map { r ->
            r to (chosen[r.index.toString()] as? JsonArray).orEmpty().mapNotNull { id -> (id as? JsonPrimitive)?.contentOrNull }
        }
        byRequirement.forEachIndexed { i, (r, ids) ->
            if (ids.size < r.maxTargets && byRequirement.drop(i + 1).any { it.second.isNotEmpty() }) {
                throw Refused("The engine reads a play's targets in order, so every target of an earlier choice has to be chosen before any of a later one.")
            }
        }
        return byRequirement.flatMap { it.second }.map { entityIdToChosenTarget(env.state, EntityId(it)) }
    }

    /** A number for each of several objects, `{"e12": 2, "e0": 1}`, or null when none was sent. */
    private fun amountsOf(v: JsonElement?): Map<EntityId, Int>? = (v as? JsonObject)?.entries
        ?.associate { (k, n) -> EntityId(k) to ((n as? JsonPrimitive)?.intOrNull ?: throw Refused("\"$k\" needs a whole number.")) }

    /**
     * What the offer's cost takes, as the person chose it, paid through the field Argentum reads
     * for that kind of cost; null when nothing was sent. A kind this protocol cannot pay by choosing
     * is refused in words rather than sent in a field the engine does not read for it.
     */
    private fun paymentOf(offer: LegalAction, params: JsonObject, existing: AdditionalCostPayment?): AdditionalCostPayment? {
        val chosen = (params["cost"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }?.map(::EntityId) ?: return null
        val kind = offer.additionalCostInfo?.costType ?: throw Refused("That offer has no cost to choose anything for.")
        val pay = PAYABLE[kind] ?: throw Refused("This protocol cannot pay a $kind cost with a choice; ask the engine to choose.")
        return pay(existing ?: AdditionalCostPayment(), chosen)
    }

    /**
     * The next step of a paced table: the engine's seat takes one more action, and the
     * table stops again, unless what comes next is the player's or the game has ended.
     *
     * Only a table dealt with a pace stops between the engine's actions, and only one
     * stopped there has a step to take. Either way round it says so rather than quietly
     * doing nothing, because a relay that asks is a relay that thinks it is paced.
     */
    fun resume(): JsonObject {
        if (!paced) throw Refused("This table is not paced: \"new\" was sent without \"pace\", so it never stops between the engine's actions and there is nothing to continue.")
        if (pausedAfter == null) throw Refused("Nothing is waiting on the engine. Ask for \"turn\" to see where the table stands.")
        drive()
        return status()
    }

    fun decide(params: JsonObject): JsonObject {
        val actor = env.agentToAct ?: throw Refused("The game is not waiting on anyone.")
        val decision = env.pendingDecision ?: throw Refused("There is no decision to make.")
        val ids = { key: String -> (params[key] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }?.map(::EntityId) }
        val response: DecisionResponse = when {
            params["auto"]?.jsonPrimitive?.boolean == true -> player(actor).respondToDecision(env.state, decision)
            decision is ChooseTargetsDecision -> {
                val chosen = params["targets"]?.jsonObject ?: throw Refused("A targets decision needs \"targets\".")
                TargetsResponse(decision.id, chosen.entries.associate { (k, v) -> k.toInt() to v.jsonArray.map { EntityId(it.jsonPrimitive.content) } })
            }
            decision is YesNoDecision -> YesNoResponse(decision.id, params["yes"]?.jsonPrimitive?.boolean ?: throw Refused("A yes/no decision needs \"yes\"."))
            decision is ChooseOptionDecision -> OptionChosenResponse(decision.id, params["option"]?.jsonPrimitive?.int ?: throw Refused("An option decision needs \"option\"."))
            decision is SelectCardsDecision -> CardsSelectedResponse(decision.id, ids("cards") ?: throw Refused("Choosing cards needs \"cards\"."))
            decision is OrderObjectsDecision || decision is ReorderLibraryDecision ->
                OrderedResponse(decision.id, ids("order") ?: throw Refused("An order needs \"order\", every object once."))
            decision is DistributeDecision -> DistributionResponse(decision.id, amountsOf(params["distribution"]) ?: throw Refused("A division needs \"distribution\"."))
            decision is CombatResolutionDecision -> CombatResolutionResponse(decision.id,
                (params["edges"] as? JsonObject ?: throw Refused("Combat damage needs \"edges\"."))
                    .entries.map { (edge, n) -> DamageEdgeAmount(edge, (n as? JsonPrimitive)?.intOrNull ?: throw Refused("\"$edge\" needs a whole number.")) })
            // "Let the engine pay" is Argentum's own auto-pay, the solver's choice of sources, which
            // is a different thing from the responder answering the whole question.
            decision is SelectManaSourcesDecision -> when {
                params["autoPay"]?.jsonPrimitive?.booleanOrNull == true -> ManaSourcesSelectedResponse(decision.id, autoPay = true)
                params["decline"]?.jsonPrimitive?.booleanOrNull == true -> ManaSourcesSelectedResponse(decision.id, declined = true)
                else -> ManaSourcesSelectedResponse(decision.id, selectedSources = ids("sources") ?: throw Refused("Paying needs \"sources\", \"autoPay\" or \"decline\"."))
            }
            decision is ChooseNumberDecision -> NumberChosenResponse(decision.id, params["number"]?.jsonPrimitive?.intOrNull ?: throw Refused("A number needs \"number\"."))
            decision is ChooseColorDecision -> ColorChosenResponse(decision.id,
                params["color"]?.jsonPrimitive?.contentOrNull?.let { c -> Color.entries.firstOrNull { it.name == c } } ?: throw Refused("A colour needs \"color\", one of ${Color.entries.joinToString(", ") { it.name }}."))
            decision is ChooseModeDecision -> ModesChosenResponse(decision.id,
                (params["modes"] as? JsonArray)?.mapNotNull { it.jsonPrimitive.intOrNull } ?: throw Refused("Choosing modes needs \"modes\"."))
            decision is BatchYesNoDecision -> BatchYesNoResponse(decision.id,
                params["yes"]?.jsonPrimitive?.booleanOrNull ?: throw Refused("A yes/no decision needs \"yes\"."),
                applyToAll = params["all"]?.jsonPrimitive?.booleanOrNull ?: false)
            else -> throw Refused("A ${decision::class.simpleName} can only be answered with \"auto\": true over this protocol.")
        }
        env.step(SubmitDecision(actor, response))
        env.lastRejection?.let { throw Refused("The engine refused that answer: $it") }
        drive()
        return status()
    }

    private fun describe(i: Int, a: LegalAction): JsonObject = if (a.actionType in MULLIGAN_OFFERS) describeMulligan(i, a) else buildJsonObject {
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
        // A cost with more in it than mana: Argentum's own kind for it and its words. Most such
        // costs are a choice — which card to discard, which creature to sacrifice — and sent bare
        // Argentum refuses them (found at M3: Flamecache Gecko's "Discard a card", refused as "Must
        // choose 1 card(s) to discard"). Said only where there is one, so an older client reads
        // the offer as it always has.
        a.additionalCostInfo?.let { put("additionalCost", it.costType); put("additionalCostText", it.description) }
        // What the cost takes, where `act` can pay it with a choice (`PAYABLE`, protocol 5): how
        // many, and of what, paid through `act`'s `cost`. A cost with a choice in it and no
        // `costChoice` is one `act` cannot pay, and a client holds that offer back, as it holds
        // back one needing a target it cannot send.
        a.additionalCostInfo?.let(::costChoiceOf)?.let { put("costChoice", it) }
        if (a.requiresForage) put("requiresForage", true)
        if (a.requiresTargets) {
            put("targetCount", a.targetCount)
            put("minTargets", a.minTargets)
            put("targetDescription", a.targetDescription)
            putJsonArray("validTargets") { a.validTargets?.forEach { add(JsonPrimitive(it.value)) } }
            // Every requirement, in the order `act` takes them. Argentum lists them itself only
            // where there is more than one; one is the flat fields above, said the same way here so
            // a client reads one shape.
            putJsonArray("targetRequirements") {
                requirementsOf(a).forEach { r ->
                    add(buildJsonObject {
                        put("index", r.index); put("description", r.description)
                        put("min", r.minTargets); put("max", r.maxTargets)
                        putJsonArray("legal") { r.validTargets.forEach { add(JsonPrimitive(it.value)) } }
                        if (r.mustDifferFromEarlier) put("distinct", true)
                    })
                }
            }
        }
        // A spell's X is announced as it is cast, and a CastSpell sent without one is cast at 0.
        // An ability's is asked by the engine itself once it is activated, as a number to choose.
        if (a.hasXCost && a.action is CastSpell) putJsonObject("x") { put("min", a.minX); put("max", a.maxAffordableX ?: a.minX) }
        // Damage divided among the targets is chosen with them, and Argentum refuses a cast at
        // more than one target without the division.
        if (a.requiresDamageDistribution) a.totalDamageToDistribute?.let { total ->
            putJsonObject("divide") { put("total", total); put("min", a.minDamagePerTarget ?: 1) }
        }
        a.validAttackers?.let { list -> putJsonArray("validAttackers") { list.forEach { add(JsonPrimitive(it.value)) } } }
        a.validAttackTargets?.let { list -> putJsonArray("validAttackTargets") { list.forEach { add(JsonPrimitive(it.value)) } } }
        a.mandatoryAttackers?.takeIf { it.isNotEmpty() }?.let { list -> putJsonArray("mandatoryAttackers") { list.forEach { add(JsonPrimitive(it.value)) } } }
        a.validBlockers?.let { list -> putJsonArray("validBlockers") { list.forEach { add(JsonPrimitive(it.value)) } } }
    }

    /**
     * An offer of the mulligan phase, with what the person needs to weigh it, every number read off
     * Argentum's own `MulliganStateComponent` rather than worked out here: `mulligans`, how many they
     * have taken; on keeping, `bottom`, how many keeping this hand puts on the bottom; on a mulligan,
     * `draws`, the hand drawn again, and `bottom`, how many keeping that one would; and on putting
     * cards on the bottom, `bottom` and the `candidates`, the hand.
     */
    private fun describeMulligan(i: Int, a: LegalAction): JsonObject = buildJsonObject {
        val m = mulliganStateOf(a.action.playerId)
        put("index", i)
        put("type", a.actionType)
        put("description", a.description)
        put("affordable", true)
        put("meaningful", true)
        put("mulligans", m.mulligansTaken)
        when (a.action) {
            is KeepHand -> put("bottom", m.cardsToBottom)
            is TakeMulligan -> { put("draws", MulliganStateComponent.STARTING_HAND_SIZE); put("bottom", m.takeMulligan().cardsToBottom) }
            is BottomCards -> {
                put("bottom", m.cardsToBottom)
                putJsonArray("candidates") { env.state.getHand(a.action.playerId).forEach { add(JsonPrimitive(it.value)) } }
            }
            else -> {}
        }
    }

    /**
     * Where the cards of an order being asked are going, read off the continuation Argentum
     * suspended with the question; null unless that question is this decision.
     */
    private fun orderGoing(d: ReorderLibraryDecision): MoveCollectionOrderContinuation? {
        val frame = env.state.peekContinuation() as? Suspension ?: return null
        if (frame.question.id != d.id) return null
        return frame.answer as? MoveCollectionOrderContinuation
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
            is SelectCardsDecision -> {
                put("min", d.minSelections); put("max", d.maxSelections)
                putJsonArray("options") { d.options.forEach { add(JsonPrimitive(it.value)) } }
                if (d.nonSelectableOptions.isNotEmpty()) putJsonArray("shown") { d.nonSelectableOptions.forEach { add(JsonPrimitive(it.value)) } }
                d.selectedLabel?.let { put("selectedLabel", it) }
                d.remainderLabel?.let { put("remainderLabel", it) }
                if (d.ordered) put("ordered", true)
                d.cardInfo?.let { put("cards", cardsOf(it)) }
            }
            is OrderObjectsDecision -> {
                putJsonArray("objects") { d.objects.forEach { add(JsonPrimitive(it.value)) } }
                d.cardInfo?.let { put("cards", cardsOf(it)) }
            }
            // Cards going to a library in an order chosen, the same answer as an order of objects.
            // Argentum asks it for cards going to the bottom as well as the top
            // (`MoveCollectionExecutor.pauseForOrderDecision`), and the decision itself says neither
            // which end nor whose library: its continuation holds both. So `placement` is "top",
            // the first card becoming the top of the library, or "bottom", the cards going under
            // it in the order given and the last the very bottom
            // (`LibraryAndZoneContinuationResumer`); `library` is the library's owner. Left out
            // where the continuation is not the one this was read from.
            is ReorderLibraryDecision -> {
                putJsonArray("objects") { d.cards.forEach { add(JsonPrimitive(it.value)) } }
                put("cards", cardsOf(d.cardInfo))
                orderGoing(d)?.let { going ->
                    put("placement", if (going.placement == ZonePlacement.Bottom) "bottom" else "top")
                    put("library", going.destinationPlayerId.value)
                }
            }
            is DistributeDecision -> {
                put("total", d.totalAmount); put("minPer", d.minPerTarget)
                putJsonArray("targets") { d.targets.forEach { add(JsonPrimitive(it.value)) } }
                if (d.maxPerTarget.isNotEmpty()) putJsonObject("maxPer") { d.maxPerTarget.forEach { (id, n) -> put(id.value, n) } }
                if (d.allowPartial) put("allowPartial", true)
            }
            // The whole combat damage step at once (Argentum's board, CR 510.1c–d): each edge an
            // amount from a source to a target, the engine's own suggestion already in it. Only the
            // edges this seat may change are its to answer; the engine keeps the rest.
            is CombatResolutionDecision -> {
                put("firstStrike", d.firstStrike)
                putJsonArray("edges") {
                    d.edges.forEach { e ->
                        add(buildJsonObject {
                            put("id", e.id); put("source", e.sourceId.value); put("target", e.targetId.value)
                            put("amount", e.amount); put("maximum", e.maximum); put("lethal", e.lethal)
                            if (e.isTrampleDrain) put("trample", true)
                            put("mine", e.editableBy == d.playerId)
                        })
                    }
                }
                putJsonArray("attackers") { d.attackers.forEach { add(buildJsonObject { put("id", it.id.value); put("name", it.name); put("power", it.power); put("trample", it.hasTrample) }) } }
                putJsonArray("blockers") { d.blockers.forEach { add(buildJsonObject { put("id", it.id.value); put("name", it.name) }) } }
                putJsonArray("defenders") { d.defenders.forEach { add(buildJsonObject { put("id", it.id.value); put("name", it.name) }) } }
            }
            is SelectManaSourcesDecision -> {
                put("cost", d.requiredCost); put("canDecline", d.canDecline)
                putJsonArray("sources") {
                    d.availableSources.forEach { s ->
                        add(buildJsonObject {
                            put("id", s.entityId.value); put("name", s.name); put("amount", s.manaAmount)
                            putJsonArray("colors") { s.producesColors.forEach { add(JsonPrimitive(it.name)) } }
                            if (s.producesColorless) put("colorless", true)
                            if (s.requiresSacrifice) put("sacrifice", true)
                        })
                    }
                }
                putJsonArray("suggested") { d.autoPaySuggestion.forEach { add(JsonPrimitive(it.value)) } }
            }
            is ChooseNumberDecision -> { put("min", d.minValue); put("max", d.maxValue) }
            is ChooseColorDecision -> putJsonArray("colors") { Color.entries.filter { it in d.availableColors }.forEach { add(JsonPrimitive(it.name)) } }
            is ChooseModeDecision -> {
                put("min", d.minModes); put("max", d.maxModes)
                putJsonArray("modes") { d.modes.forEach { add(buildJsonObject { put("index", it.index); put("text", it.text); put("available", it.available) }) } }
            }
            is BatchYesNoDecision -> { put("count", d.count); put("yesText", d.yesText); put("noText", d.noText) }
            else -> put("askable", false)
        }
    }

    /**
     * Cards a decision shows that the table may not have: a library's top, a search. Their names
     * and faces travel with the decision because the view does not carry a hidden zone's cards.
     * They are this seat's to see, and the room keeps them from every other seat's copy of the
     * status (scripts/relay-engine.mjs).
     */
    private fun cardsOf(info: Map<EntityId, SearchCardInfo>): JsonObject = buildJsonObject {
        info.forEach { (id, c) ->
            putJsonObject(id.value) {
                put("name", c.name); put("manaCost", c.manaCost); put("typeLine", c.typeLine)
                c.imageUri?.let { put("imageUri", it) }
            }
        }
    }
}

/**
 * Whether what the engine's seat chose is a play worth stopping a paced table for: the engine's
 * own `MeaningfulActionFilter` asked of the offer it was chosen from, and a declaration that
 * declares something.
 *
 * The choice comes back filled in — an attack with its attackers, a block with its blockers, a
 * spell with its targets and its X — so it is never equal to the bare offer it was chosen from.
 * Until M4 this compared them by equality, and so never stopped for the engine's attacks, its
 * blocks or anything it aimed: measured over eight paced games on 2026-09-24, every one of the
 * engine's stops fell in a main phase, while it attacked in most of its turns. That was why no
 * view a client was sent carried declared blockers (PLAN.md, M2), and it was not that combat
 * resolves between two stops. A choice is matched to its offer by what it is instead: the same
 * card cast, the same ability of the same source.
 */
private fun worthWatching(offers: List<LegalAction>, chosen: GameAction): Boolean = when (chosen) {
    is DeclareAttackers -> chosen.attackers.isNotEmpty()
    is DeclareBlockers -> chosen.blockers.isNotEmpty()
    else -> offers.any { MeaningfulActionFilter.isMeaningful(it) && sameOffer(it.action, chosen) }
}

private fun sameOffer(offered: GameAction, chosen: GameAction): Boolean = offered == chosen || when {
    offered is CastSpell && chosen is CastSpell -> offered.cardId == chosen.cardId
    offered is ActivateAbility && chosen is ActivateAbility -> offered.sourceId == chosen.sourceId && offered.abilityId == chosen.abilityId
    else -> false
}

/**
 * An offer's target requirements, in order. Argentum lists them in `targetRequirements` only
 * where there is more than one, and describes a single one with the offer's own flat fields.
 */
private fun requirementsOf(a: LegalAction): List<TargetInfo> = a.targetRequirements
    ?: if (a.requiresTargets) listOf(TargetInfo(0, a.targetDescription ?: "", a.minTargets, a.targetCount, a.validTargets.orEmpty())) else emptyList()

/**
 * What an offer's cost takes, when `act` can pay it with a person's choice: the candidates
 * Argentum lists for that kind of cost and how many of them it takes. Null for a cost this
 * protocol cannot pay by choosing, which a client holds back as before, and for exiling cards up
 * to a total of mana value, which is a sum and not a count.
 */
private fun costChoiceOf(info: AdditionalCostData): JsonObject? {
    if (info.costType !in PAYABLE) return null
    val (candidates, min, max) = when (info.costType) {
        "DiscardCard" -> Triple(info.validDiscardTargets, info.discardCount, info.discardCount)
        "SacrificePermanent" -> Triple(info.validSacrificeTargets, info.sacrificeCount, info.sacrificeCount)
        "TapPermanents" -> Triple(info.validTapTargets, info.tapCount, info.tapCount)
        "BouncePermanent" -> Triple(info.validBounceTargets, info.bounceCount, info.bounceCount)
        "ExileFromGraveyard", "ExileFromHand" -> {
            if (info.exileMinTotalWeight > 0 || info.exileWeightPerTarget.isNotEmpty()) return null
            Triple(info.validExileTargets, info.exileMinCount, maxOf(info.exileMinCount, info.exileMaxCount))
        }
        "Behold" -> Triple(info.validBeholdTargets, info.beholdCount, info.beholdCount)
        "RevealCard" -> Triple(info.validRevealTargets, info.revealCount, info.revealCount)
        "Blight" -> Triple(info.validBlightTargets, 1, 1)
        else -> return null
    }
    if (max <= 0) return null
    return buildJsonObject {
        put("min", min); put("max", max)
        putJsonArray("candidates") { candidates.forEach { add(JsonPrimitive(it.value)) } }
    }
}

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

/**
 * Whether a table was asked to be paced, from `new`'s `pace`.
 *
 * `true` or a number of milliseconds both mean yes. The number is the relay's own pace
 * between steps, and the engine reads it only as a yes: it never sleeps, because one
 * process serves one table over one line and a process that waited would hold up every
 * other request on it. Absent, false or nothing positive is today's behaviour exactly.
 */
private fun pacedBy(params: JsonObject): Boolean = when (val v = params["pace"]) {
    is JsonPrimitive -> v.booleanOrNull ?: ((v.doubleOrNull ?: 0.0) > 0.0)
    else -> false
}

/**
 * Who plays a seat, from `new`'s player: nobody here (a person), a random player, or the
 * engine's own at a level.
 *
 * `ai` is `"heuristic"` or `"random"`, as before levels; one of the level words is read as a
 * heuristic seat at that level too, which is the shape HANDOFF.md first sketched. `level` picks
 * the profile. A level this engine has not heard of — a newer relay's — is not a reason to
 * refuse a game: the seat plays as a heuristic seat always has, and the reply says it was
 * asked for no level it knows, so the relay can say so rather than name one. `profile` is for
 * measurement and names an Argentum profile outright; an id not in `PROFILES` is refused.
 */
private fun playerOf(o: JsonObject): Triple<String?, AiProfile?, String?> {
    val asked = o["ai"]?.jsonPrimitive?.contentOrNull ?: return Triple(null, null, null)
    if (asked == "random") return Triple("random", null, null)
    val level = (o["level"]?.jsonPrimitive?.contentOrNull ?: asked).takeIf { it in LEVELS }
    val named = o["profile"]?.jsonPrimitive?.contentOrNull
    if (named != null) {
        val profile = PROFILES[named] ?: throw Refused("No AI profile \"$named\" here; these are: ${PROFILES.keys.joinToString(", ")}.")
        return Triple("heuristic", profile, null)
    }
    return Triple("heuristic", level?.let(LEVELS::getValue) ?: AiProfile.CURRENT, level)
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
    // The opening hands are the players' to keep only where asked (protocol 6): a relay asks
    // for it where every person's client can show a mulligan. Unasked, every hand is kept, as
    // every engine before this dealt. `skipMulligans`, the key Argentum's own config names, is
    // read too, where `mulligans` is not said.
    val opening = (params["mulligans"] as? JsonPrimitive)?.booleanOrNull
        ?: (params["skipMulligans"] as? JsonPrimitive)?.booleanOrNull?.not()
        ?: false
    // Dealt here, not by env.reset: reset builds its GameInitializer without a printing
    // registry, so every card would wear the default art whatever printing the deck named.
    // restore installs the deal and drops its events, which the Table keeps for the log.
    val dealt = GameInitializer(registry, corpus.printings).initializeGame(GameConfig(
        players = configs,
        skipMulligans = !opening,
        startingPlayerIndex = params["startingPlayer"]?.jsonPrimitive?.int ?: 0,
        seed = seed,
    ))
    env.restore(dealt.state, dealt.playerIds)
    val seats = env.playerIds.mapIndexed { i, id ->
        val o = players[i].jsonObject
        val (ai, profile, level) = playerOf(o)
        // The decisions a person's client said it can show, of those this process can ask. A word
        // it does not know — a newer client's — is not asked, and not a reason to refuse the game.
        val answers = (o["answers"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.filter { it in ASKABLE }
        Seat(id, configs[i].name, ai, o["autoPass"]?.jsonPrimitive?.boolean ?: false, leftOutOfSideboards[i], printingsMissed[i], profile, level,
            asks = if (ai == null) ALWAYS_ASKED + answers else emptySet())
    }
    return Table(registry, env, seats, seed, pacedBy(params), dealt.events, opening)
}

private fun seatsOf(table: Table): JsonArray = buildJsonArray {
    table.seats.forEach { s ->
        add(buildJsonObject {
            put("id", s.id.value); put("name", s.name); put("ai", s.ai); put("autoPass", s.autoPass)
            // What the seat plays with, said only for a seat the engine plays: the level it
            // took, if it was asked for one it has, and Argentum's own id for the profile.
            if (s.profile != null) { put("level", s.level); put("profile", s.profile.id) }
            // What a person will be asked rather than have answered for them, so the relay can
            // tell their client which of its prompts will ever be shown.
            if (s.ai == null) putJsonArray("asked") { ASKABLE.filter { it in s.asks }.forEach { add(JsonPrimitive(it)) } }
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
                    // The levels a seat may be asked to play at, each with the Argentum profile
                    // it plays with, in order from the weakest.
                    putJsonObject("levels") { LEVELS.forEach { (word, profile) -> put(word, profile.id) } }
                    // What a person may choose over this protocol: what `act` takes beyond an index,
                    // the costs it can pay with a choice, and the decisions it can put to them.
                    putJsonObject("choices") {
                        putJsonArray("act") { ACT_TAKES.forEach { add(JsonPrimitive(it)) } }
                        putJsonArray("costs") { PAYABLE.keys.forEach { add(JsonPrimitive(it)) } }
                        putJsonArray("decisions") { ASKABLE.forEach { add(JsonPrimitive(it)) } }
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
                    // `paced` and `mulligans` are said only when on, as everything else this
                    // process leaves off the wire is: a relay sees whether the engine understood
                    // what it asked for rather than assuming an older one did.
                    JsonObject(t.status() + mapOf("seats" to seatsOf(t), "seed" to JsonPrimitive(t.seed)) +
                        (if (t.paced) mapOf("paced" to JsonPrimitive(true)) else emptyMap()) +
                        (if (t.opening) mapOf("mulligans" to JsonPrimitive(true)) else emptyMap()))
                }
                "turn" -> (table ?: throw Refused("No game yet. Send \"new\" first.")).status()
                // One more of the engine's own actions, on a paced table. The relay asks
                // for this at the room's pace, publishing a view between steps.
                "continue" -> (table ?: throw Refused("No game yet. Send \"new\" first.")).resume()
                "act" -> (table ?: throw Refused("No game yet.")).act(req["index"]?.jsonPrimitive?.int ?: throw Refused("\"index\" is required."), req)
                "decide" -> (table ?: throw Refused("No game yet.")).decide(req)
                // How long the engine's seats took to choose, since the last time this was
                // asked. The relay never asks; scripts/engine-levels.mjs does.
                "clock" -> (table ?: throw Refused("No game yet.")).readClock()
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
