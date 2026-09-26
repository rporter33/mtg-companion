package companion

import com.wingedsheep.ai.engine.AIPlayer
import com.wingedsheep.ai.engine.AiProfile
import com.wingedsheep.ai.engine.EngineAiPlayerController
import com.wingedsheep.ai.engine.deck.CommanderDeckGenerator
import com.wingedsheep.ai.engine.deck.ConstructedDeckGenerator
import com.wingedsheep.ai.draftsim.DraftsimDeckShape
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
import com.wingedsheep.engine.core.CommanderZoneChoiceContinuation
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
import com.wingedsheep.engine.core.engineSerializersModule
import com.wingedsheep.engine.handlers.MulliganHandler
import com.wingedsheep.engine.handlers.continuations.entityIdToChosenTarget
import com.wingedsheep.engine.legalactions.AdditionalCostData
import com.wingedsheep.engine.legalactions.LegalAction
import com.wingedsheep.engine.legalactions.MeaningfulActionFilter
import com.wingedsheep.engine.legalactions.TargetInfo
import com.wingedsheep.engine.limited.BoosterGenerator
import com.wingedsheep.engine.state.components.identity.CardComponent
import com.wingedsheep.engine.state.components.identity.CommanderComponent
import com.wingedsheep.engine.state.components.player.MulliganStateComponent
import com.wingedsheep.engine.state.components.stack.ChosenTarget
import com.wingedsheep.engine.state.GameState
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
import com.wingedsheep.mtg.sets.legality.LegalityData
import com.wingedsheep.mtg.sets.tokens.PredefinedTokens
import com.wingedsheep.sdk.core.Color
import com.wingedsheep.sdk.core.DeckFormat
import com.wingedsheep.sdk.core.Format
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
 * decides what the engine leaves open, and says each thing it decides:
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
 *  - **The engine's seat may play a deck of its own.** Asked for one, it is
 *    built by Argentum's own `ConstructedDeckGenerator` from the sets and the
 *    format the relay names, seeded from the game (`deckFor`); where that cannot
 *    be done it falls back to the whole format, then to a copy of the person's
 *    deck, and the reply says which and why rather than refuse the game.
 *  - **A game may be Commander.** Argentum's own `Format.Commander` — 40 life, the
 *    commander in the command zone, commander tax, 21 combat damage from one commander —
 *    with the CR 903.9a question left to the commander's owner, as Argentum leaves it by
 *    default. Every player then names a commander, and the engine's seat may have one of its
 *    own built by Argentum's `CommanderDeckGenerator`. Duel Commander and Brawl are the same
 *    `Format.Commander` at their own life totals, for two players, with no loss by commander
 *    damage (`GAME_FORMATS`).
 *  - **What is worth watching is Law 1's question turned around.** A paced
 *    table stops after each of the engine's own plays so they can be seen
 *    happening, but not after a priority pass or a mana ability: the same
 *    `MeaningfulActionFilter` answers both.
 *  - **A game can be kept, and taken back by another process.** `snapshot` writes the game as it
 *    stands — Argentum's own `GameState`, its random number generator inside it, and what this
 *    process keeps beside it: the seats, each seat's log, a paced table's pause — and `restore` takes
 *    it into a fresh process at the same stop, so a room outlives its relay and its engine
 *    (HANDOFF.md, M7). What cannot travel is said where it is kept (`snapshot`).
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
// 7: an engine's seat need not bring a deck. Its "deck" in "new" may be "mirror", a copy of the first
// person's deck and sideboard, or "own", a deck Argentum's ConstructedDeckGenerator builds for it to
// the "format" given (Scryfall's word) from the "sets" given, or from the whole format where none
// are; a list of names is taken as before. The reply's seat says what it plays and how it came to
// ("deck"), falling back in words where a deck of its own could not be built. "hello" lists the
// formats it builds to ("decks"), and "decklist" is new, for measuring. An engine at 6 reads a
// "deck" that is not a list as no deck and refuses the game, so a relay reading 6 sends names.
// 8: a game may be Commander. "new" takes "format": "commander", and every player a "commander", a
// name or {name, set, number}; the game is Argentum's Format.Commander, the commanders dealt into the
// command zone. An engine's seat asked for "own" at such a table is built a Commander deck, commander
// and all, by CommanderDeckGenerator, and "mirror" copies the person's commander with their deck. An
// offer cast from the command zone says so ("from") and what the commander tax adds ("commanderTax"),
// and the CR 903.9a yes or no says where the commander is ("commanderZone"). The reply says "format"
// where the game is Commander, and each seat its commander. "hello" lists the game formats
// ("formats"). An engine at 7 ignores "format" and "commander" and deals the decks as sent, by the
// ordinary rules, so a relay reading 7 must not tell anybody a Commander game is coming.
// 9: a game may be kept and taken back. "snapshot" answers the game as it stands, as text, and
// "restore" takes that text into a process that holds no game yet and answers as "new" does, at the
// same stop. The text is not JSON on the wire but a string holding it, because the game's random
// number generator is a 64-bit number, which a relay reading JSON as JavaScript would round to another
// one, and so to another game. An engine at 8 refuses both as unknown ops, so a relay reading 8 keeps
// no game and must say so, rather than promise a room that could come back.
// 10: a Commander game may be Duel Commander or Brawl (HANDOFF.md §3 item 20). "new" takes "format":
// "duel" or "brawl" for a game of two, each Argentum's Format.Commander at that game's own life total,
// with no loss by commander damage; an engine's seat asked for "own" at a Brawl table is built a Brawl
// deck of its own (Argentum's DeckFormat.BRAWL), and at a Duel Commander table is dealt the copy, since
// Argentum has no Duel Commander card pool. The reply to "new" and "restore" says "rules" for any
// Commander game: its life total, its deck size and the commander damage that loses it, or null where
// none does. "hello" lists the two in "formats". An engine at 9 refuses both words as games it does not
// deal, so a relay reading 9 must not ask for either.
const val PROTOCOL = 10

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
 * The formats an engine's seat can be given a deck of its own in (protocol 7, HANDOFF.md M5), by
 * Scryfall's word for each, which is the word the app sends: every one of Argentum's `DeckFormat`s
 * that `ConstructedDeckGenerator` builds to. It refuses the Commander family outright and points at
 * `CommanderDeckGenerator`, which builds that shape with a commander chosen first (`COMMANDER_BUILDS`).
 */
private val BUILDS: Map<String, DeckFormat> = DeckFormat.entries.filterNot { it.isCommanderShape }.associateBy { it.scryfallKey }

/**
 * The commander damage that loses a Commander game whose own rules have no such loss (protocol 10):
 * Brawl's (CR 903.12h, which sets aside the state-based action of 704.6c) and Duel Commander's (its
 * committee's rules, 506.1a). Argentum's `Format.Commander` always has a threshold — a game uses
 * commanders exactly where it has one (`Format.usesCommanders`) — and its state-based action loses a
 * player whose tally from one commander reaches it (`CommanderDamageLossCheck`), so a game in which
 * commander damage loses nobody is asked for as one whose threshold no tally can reach. Argentum still
 * keeps the tally and puts it in the view, with this as its threshold; the reply's `rules` says null.
 */
private const val NO_COMMANDER_DAMAGE_LOSS = Int.MAX_VALUE

/**
 * The game formats this process deals (protocol 8, HANDOFF.md M6), by the word `new` takes: the
 * ordinary rules, Argentum's `Format.Standard` — what every table before this was dealt, whatever the
 * decks' own format — and Commander, Argentum's `Format.Commander` as it stands: 40 life, a hundred
 * cards, the commander in the command zone, commander tax, and 21 combat damage from one commander.
 * Its `alwaysDivertToCommand` is left off, as Argentum leaves it, so the CR 903.9a question is the
 * commander's owner's to answer, a yes or no every client can already put on screen.
 *
 * Since protocol 10 (HANDOFF.md §3 item 20), Duel Commander and Brawl too, each as the same
 * `Format.Commander` with its own numbers, which is how Argentum's own comments on the type say those
 * games are to be had ("Commander-shaped data with different field values"). Duel Commander is not in
 * the Comprehensive Rules; its numbers are its committee's (300.1a: 20 life; 402.1b: a hundred cards;
 * 506.1a: no loss by commander damage). Brawl's are the Comprehensive Rules' for two players (903.12f:
 * 25 life; 903.12h: no loss by commander damage), at a hundred cards, which is the Brawl the app's decks
 * are built to (Scryfall's `brawl`, Argentum's `DeckFormat.BRAWL`) where 903.12d's is sixty; the deck
 * size is Argentum's validator's to hold, and its initializer deals what it is sent. What Argentum does
 * not take from the format is not dealt here either: Brawl's free first mulligan (903.12g) — Argentum
 * makes a first mulligan free only at a table of more than two — and every rule of deck construction,
 * which are the app's deck checker's. Argentum's own Brawl preset (`CommanderPreset.BRAWL`, 25 life and
 * 16 commander damage) is its tuning for drafted sixty-card decks, and is not this.
 */
private val GAME_FORMATS: Map<String, Format> = linkedMapOf(
    "standard" to Format.Standard,
    "commander" to Format.Commander(),
    "duel" to Format.Commander(startingLife = 20, commanderDamageThreshold = NO_COMMANDER_DAMAGE_LOSS),
    "brawl" to Format.Commander(startingLife = 25, commanderDamageThreshold = NO_COMMANDER_DAMAGE_LOSS),
)

/**
 * The games dealt only to two players (protocol 10): Duel Commander is made for one against one (its
 * committee's rules, 205.1a), and Brawl's life total is 25 only in a game of two, and 30 in one of more
 * (903.12f), which this process does not deal.
 */
private val TWO_PLAYER_GAMES = setOf("duel", "brawl")

/**
 * The formats an engine's seat can be built a Commander deck of its own in, by the game it is dealt
 * in: at a Commander table a Commander deck, and since protocol 10 at a Brawl table a Brawl deck, by
 * Argentum's own `DeckFormat.BRAWL` — Scryfall's `brawl`, a hundred cards. Argentum has no Duel
 * Commander format among its `DeckFormat`s, and its legality data's word for one is dropped as it is
 * read (`LegalityData`), so there is no Duel Commander card pool to build from, and none is built.
 */
private val COMMANDER_BUILDS: Map<String, DeckFormat> = mapOf(
    DeckFormat.COMMANDER.scryfallKey to DeckFormat.COMMANDER,
    DeckFormat.BRAWL.scryfallKey to DeckFormat.BRAWL,
)

/** A game format by name, as a reason says it. */
private val GAME_NAMES = mapOf("commander" to "Commander", "duel" to "Duel Commander", "brawl" to "Brawl")

/**
 * What a Commander game dealt holds a player to (protocol 10), off the game's own `Format`: its life
 * total, its deck size, and the commander damage that loses it, or null where none does. Read off the
 * game itself, so a game taken back says what it was dealt with. Null for a game with no commanders.
 */
private fun rulesOf(format: Format): JsonObject? {
    val commander = format as? Format.Commander ?: return null
    return buildJsonObject {
        put("life", commander.startingLife)
        put("deckSize", commander.deckSize)
        put("commanderDamage", commander.commanderDamageThreshold.takeIf { it != NO_COMMANDER_DAMAGE_LOSS })
    }
}

/**
 * How many cards a deck of the engine's own must hold to be dealt: Draftsim's constructed shape, the
 * size `ConstructedDeckGenerator` checks its own build against (36 spells and 24 lands). Its random
 * fallback stops short when a pool runs out of cards to add, and says nothing, so the size is
 * checked here and a short deck is a deck that could not be built.
 */
private val OWN_SIZE = DraftsimDeckShape.CONSTRUCTED.let { it.nonlandCount + it.landCount }

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

/**
 * How a kept game is written (protocol 9): Argentum's own settings for persisting one, as its game
 * server's `persistenceJson` has them, less the log types that server registers for itself — a
 * `ClientEvent` is written here by its own sealed serializer. `engineSerializersModule` names every
 * polymorphic thing a `GameState` holds; `allowStructuredMapKeys` is there because its zones are keyed
 * by an object; the discriminator is `type` because Argentum's reader of older states looks for it
 * there (`LegacyGameStateSerializer`); and defaults are written, as Argentum writes them, so a value
 * that happens to equal its default is not left to a default that may one day change.
 */
private val snapshotJson = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
    classDiscriminator = "type"
    allowStructuredMapKeys = true
    serializersModule = engineSerializersModule
}

/** What a kept game says it is, so a text that is anything else is refused in words rather than half read. */
private const val SNAPSHOT_KIND = "companion-game"

/**
 * The shape of a kept game this process writes and reads. Bumped when the shape changes, so a newer
 * process refuses an older game in words instead of taking back something other than what was kept.
 */
private const val SNAPSHOT_VERSION = 1

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
    /** The deck this seat was dealt, as lines: for `decklist`, which is for measuring. */
    val dealt: List<Line> = emptyList(),
    /** For a seat the engine plays, what deck it was asked for and what it plays (protocol 7). */
    val built: Built? = null,
    /** At a Commander table, this seat's commander by the name the engine knows it by (protocol 8). */
    val commander: String? = null,
    /**
     * For a seat the engine plays in a game taken back from a snapshot (protocol 9), what its deck was
     * said to be at the deal, as it was said: the builder's own account (`built`) does not travel, and
     * the words it gave rise to do.
     */
    val report: JsonObject? = null,
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
    /** The game format it was dealt in, by `GAME_FORMATS`' word (protocol 8). */
    val format: String = "standard",
) {
    val transformer = ClientStateTransformer(registry)
    val lastView = HashMap<EntityId, ClientGameState>()
    /** How much of each seat's log it has been sent, so a delta carries only what is new. */
    val sentLines = HashMap<EntityId, Int>()
    /** What each seat has been told happened, in its own words: the game log. */
    val logs = HashMap<EntityId, MutableList<LogLine>>()
    private var logged = 0
    /**
     * The step the game stood in at the last event recorded, carried from one batch to the next, and
     * from one process to the next with a kept game (protocol 9): the next line is filed under it.
     */
    var step: Step? = null
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

    /**
     * The game as it stands, written down so another process can take it back (protocol 9,
     * HANDOFF.md M7): Argentum's `GameState` whole, and beside it what this process keeps that
     * Argentum does not — who sits where and how each seat is played, each seat's log in its own
     * words, the step the next line is filed under, and a paced table's pause after one of the
     * engine's plays.
     *
     * The random number generator is in the state (`GameState.rng`, one 64-bit number), so the
     * game taken back shuffles and flips as this one would have. So is every question waiting on an
     * answer: Argentum keeps a suspended decision and what follows it in the state too.
     *
     * What does not travel, and why it is not needed or what it costs:
     *  - The last view each seat was sent and how much of its log. A process taken back sends each
     *    seat the table whole, log and all, which starts both counts again.
     *  - The offers on the table. They are the engine's own legal actions at this position, found
     *    again when the game is taken back (`settle`).
     *  - The engine's players. Argentum's search seeds itself from the position alone
     *    (`RolloutCandidateEvaluator.rootSeedFor`, `Determinizer.sampleForSearch`), so a player built
     *    again chooses as the old one would — but for one thing: its `Strategist` remembers the
     *    positions it has acted from (32 of them, each marked with its turn and step), to keep it from
     *    going round in circles, and a new one remembers none. It can matter only inside the step the
     *    game was kept in. A random player (`ai: "random"`, a test opponent) starts its own sequence
     *    again, and plays differently from there.
     *  - What the engine has passed and decided for a person since the last stop. Nothing: a game is
     *    written at a stop, where both have just been said.
     */
    fun snapshot(corpus: Corpus): String {
        record()
        val doc = buildJsonObject {
            put("kind", SNAPSHOT_KIND)
            put("version", SNAPSHOT_VERSION)
            put("protocol", PROTOCOL)
            put("state", snapshotJson.encodeToJsonElement(GameState.serializer(), env.state))
            putJsonArray("playerIds") { env.playerIds.forEach { add(JsonPrimitive(it.value)) } }
            put("stepCount", env.stepCount)
            put("seed", seed)
            put("paced", paced)
            put("opening", opening)
            put("format", format)
            put("step", step?.name)
            put("pausedAfter", pausedAfter?.value)
            putJsonArray("seats") { seats.forEach { add(seatRecord(it, corpus)) } }
            putJsonObject("logs") {
                for (s in seats) putJsonArray(s.id.value) {
                    logs[s.id].orEmpty().forEach { line ->
                        add(buildJsonObject {
                            put("event", snapshotJson.encodeToJsonElement(ClientEvent.serializer(), line.event))
                            line.step?.let { put("step", it.name) }
                        })
                    }
                }
            }
        }
        return snapshotJson.encodeToString(JsonObject.serializer(), doc)
    }

    /**
     * A game just taken back, brought to the stop it was kept at: the offers found again, without
     * the game moving on. A game is kept only at a stop, which `drive` returned at, so asked again at
     * the same position it returns there again — the same seat, the same offers or the same question,
     * in the same order. A paced table kept while waiting on the engine is not driven at all: that
     * stop is the relay's to take on with `continue`, and driving it would take the engine's next
     * play here, unwatched.
     */
    fun settle() { if (pausedAfter == null) drive() }

    /** One seat as a kept game holds it: everything `Seat` is, its deck's words in place of its builder. */
    private fun seatRecord(s: Seat, corpus: Corpus): JsonObject = buildJsonObject {
        put("id", s.id.value); put("name", s.name); put("ai", s.ai); put("autoPass", s.autoPass)
        putJsonArray("sideboardLeftOut") { s.sideboardLeftOut.forEach { add(JsonPrimitive(it)) } }
        putJsonArray("unknownPrintings") { s.unknownPrintings.forEach { add(JsonPrimitive(it)) } }
        put("profile", s.profile?.id)
        put("level", s.level)
        putJsonArray("asks") { s.asks.forEach { add(JsonPrimitive(it)) } }
        putJsonArray("dealt") {
            s.dealt.forEach { l -> add(buildJsonObject { put("name", l.name); put("count", l.count); put("set", l.set); put("number", l.number) }) }
        }
        put("commander", s.commander)
        deckReport(s, corpus)?.let { put("deck", it) }
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
        // A commander cast from the command zone (protocol 8): said, since a tap on the command
        // zone is how a person reaches it, with what the commander tax adds to the cost above, which
        // Argentum has already put in it (CR 903.8): {2} for each time before this that its owner cast
        // it from there, read off the card's own count. Said only for the command zone, so an offer
        // from anywhere else reads as it always has.
        if (a.sourceZone == Zone.COMMAND.name) {
            put("from", "command")
            (a.action as? CastSpell)?.let { taxOf(it.cardId) }?.let { put("commanderTax", it) }
        }
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

    /**
     * What the commander tax adds to a commander cast from the command zone now (CR 903.8), in
     * Argentum's own count, which its cost calculator reads for the tax: how many times its owner
     * has cast it from there, and the generic mana that adds, {2} apiece.
     */
    private fun taxOf(id: EntityId): JsonObject? {
        val commander = env.state.getEntity(id)?.get<CommanderComponent>() ?: return null
        return buildJsonObject { put("casts", commander.castsFromCommandZone); put("generic", 2 * commander.castsFromCommandZone) }
    }

    /**
     * The zone a commander is in while its owner is asked whether to put it into the command zone,
     * read off the continuation Argentum suspended with the question (`CommanderZoneChoiceCheck`,
     * its CR 903.9a state-based action); null unless that question is this decision. Argentum asks
     * it for a commander in a graveyard or exile, and in a hand or a library too.
     */
    private fun commanderGoing(d: YesNoDecision): Zone? {
        val frame = env.state.peekContinuation() as? Suspension ?: return null
        if (frame.question.id != d.id) return null
        return (frame.answer as? CommanderZoneChoiceContinuation)?.currentZone
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
            // The commander's owner asked whether it goes to the command zone (protocol 8): where it
            // is now, by the board's word for the zone, so a client can say which rule asks it.
            is YesNoDecision -> {
                put("yesText", d.yesText); put("noText", d.noText); put("hint", d.hint)
                commanderGoing(d)?.let { put("commanderZone", it.name.lowercase()) }
            }
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
    /**
     * Every set as Argentum's deck generators read one, by its code (protocol 7): its own cards,
     * its reprint rows and its basic lands. Nothing here opens a booster; the constructed
     * generator reads a set's pool and its basics from this, as game-server's does from its own.
     */
    val boosters: BoosterGenerator,
    val loadMs: Long,
    /** Of `loadMs`, what stamping every card with the formats it is legal in took (protocol 7). */
    val legalMs: Long,
    val heapMb: Long,
)

private const val MB = 1024L * 1024L

private fun corpus(): Corpus {
    val started = System.nanoTime()
    val sets = MtgSetCatalog.all
    // Stamped once, for the registry and the generators alike: a copy of every card twice over
    // would be twice the corpus for nothing. With the formats each card is legal in, as
    // game-server stamps them (`withLegalities`), from the Scryfall legalities Argentum ships
    // (LegalityData): a card definition carries none of its own, and without them every format's
    // pool is empty to a deck generator, which reads nothing else (FormatCardPool).
    val withSets = sets.associateWith { set -> set.cards.stamped(set) }
    // Timed on its own, so what the legalities cost to load is a number in `hello` rather than a guess.
    val legalStarted = System.nanoTime()
    val stamped = withSets.mapValues { (_, cards) -> cards.map(LegalityData::stamp) }
    val basics = sets.associateWith { set -> (set.basicLands + set.basicLandsFallback?.basicLands.orEmpty()).map(LegalityData::stamp) }
    val legalMs = (System.nanoTime() - legalStarted) / 1_000_000
    val registry = CardRegistry().apply {
        register(PredefinedTokens.allTokens)
        for (set in sets) {
            register(stamped.getValue(set))
            register(basics.getValue(set))
        }
    }
    // As game-server builds its own (GameBeansConfig.toBoosterSetConfig), less what only a
    // booster needs: the set's cards, its reprint rows, which FormatCardPool resolves through the
    // registry so a set that is mostly reprints is not taken for an empty one, and its basics,
    // or the set's own fallback for them, whose art a deck built from the set is dealt with.
    val boosters = BoosterGenerator(sets.associate { set ->
        set.code to BoosterGenerator.SetConfig(
            setCode = set.code,
            setName = set.displayName,
            cards = stamped.getValue(set),
            basicLands = (set.basicLandsFallback ?: set).basicLands,
            incomplete = set.incomplete,
            releaseDate = set.releaseDate,
            printings = set.printings,
        )
    })
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
    return Corpus(registry, printings, sets, deckable, boosters, loadMs, legalMs, (rt.totalMemory() - rt.freeMemory()) / MB)
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

/**
 * What a seat the engine plays was dealt, and how it came to be (protocol 7, HANDOFF.md M5).
 *
 * `asked` is what the relay asked for: `deck`, a list of names as every seat has always been
 * sent; `mirror`, a copy of the first person's deck; or `own`, one Argentum builds for it. `played`
 * is what it plays, which differs from `asked` only where a deck of its own could not be built and
 * a copy of the person's was dealt instead. `fellBack` says why, whenever what was dealt is not
 * what was asked — that includes a deck of its own built from the whole format rather than the
 * sets asked — and `why` carries Argentum's own words for it where it gave any.
 *
 * `fellBack` is one of: `format`, a format the generator does not build to (the Commander family,
 * or a word it has no format for); `sets`, none of the sets asked is one the engine has; `thin`,
 * the cards legal in the format among those asked for could not fill a deck; `failed`, anything
 * else the generator did, said in its own words.
 */
private class Built(
    val asked: String,
    val played: String,
    val lines: List<Line>,
    val sideboard: List<Line> = emptyList(),
    /** For a deck of its own: the format it was built to, as asked and as Argentum has it. */
    val formatWord: String? = null,
    val format: DeckFormat? = null,
    /** For a deck of its own: `sets` where it was built from the sets asked, `format` from the whole format. */
    val from: String? = null,
    val sets: List<BoosterGenerator.SetConfig> = emptyList(),
    /** The sets asked for that the engine has not got, so were not drawn from; in the words they were asked in. */
    val missingSets: List<String> = emptyList(),
    val fellBack: String? = null,
    val why: String? = null,
    /** At a Commander table, the seat's commander: the person's, copied, or one Argentum chose first (protocol 8). */
    val commander: Line? = null,
)

/** A deck line from what a generator wrote. */
private fun generatedLine(key: String, count: Int): Line {
    // Argentum pins a generated deck's basics to the set it was built from as
    // "Plains#BLB-262" (BoosterGenerator.withBasicLandArt), and its random builder as
    // "Plains#262", a number with no set to find it in. The first is a printing this
    // process deals as any deck's named printing is dealt; the second names none.
    val name = key.substringBefore('#')
    val printing = key.substringAfter('#', "")
    val set = printing.substringBefore('-', "").takeIf { it.isNotEmpty() }
    val number = printing.substringAfter('-', "").takeIf { set != null && it.isNotEmpty() }
    return Line(name, count, set, number)
}

/** The outcome of asking Argentum's generator for a deck: its lines, and for a Commander deck, its commander. */
private sealed class Generated {
    class Dealt(val lines: List<Line>, val commander: Line? = null) : Generated()
    class Failed(val code: String, val why: String?) : Generated()
}

/**
 * A deck Argentum's `ConstructedDeckGenerator` builds to [format], from [codes] or from every card
 * the format allows where there are none. Its randomness is seeded from the game's, so the same
 * seed builds the same deck — any game can still be played again exactly — and a game dealt with
 * another seed, as every game the relay starts without one is, builds another.
 *
 * What comes back is held to what this table can deal: at least `OWN_SIZE` cards, each a name a
 * deck may hold. The generator refuses a pool with no legal cards in words, and its random fallback
 * can come back short with none, so both are a deck it could not build.
 */
private fun generate(corpus: Corpus, codes: List<String>, format: DeckFormat, seed: Long): Generated {
    val list = try {
        ConstructedDeckGenerator(corpus.boosters, corpus.registry, kotlin.random.Random(seed)).generate(codes, format)
    } catch (e: IllegalArgumentException) {
        return Generated.Failed("thin", e.message)
    } catch (e: IllegalStateException) {
        return Generated.Failed("thin", e.message)
    } catch (e: Exception) {
        return Generated.Failed("failed", "${e::class.simpleName}: ${e.message}")
    }
    val lines = list.map { (key, n) -> generatedLine(key, n) }
    val size = lines.sumOf { it.count ?: 0 }
    if (size < OWN_SIZE) return Generated.Failed("thin", "The deck came to $size cards, short of $OWN_SIZE.")
    val strange = lines.map { it.name }.distinct().filter { resolveName(corpus, it) == null }
    if (strange.isNotEmpty()) return Generated.Failed("failed", "It chose ${strange.joinToString(", ")}, which a deck here cannot hold.")
    return Generated.Dealt(lines)
}

/**
 * A Commander deck Argentum's `CommanderDeckGenerator` builds (protocol 8, HANDOFF.md M6): a commander
 * chosen first, as its game server's `RandomDeckResolver` uses it, and a singleton library inside its
 * colour identity, from [codes] or from every card the format allows where there are none. Seeded
 * from the game, as a constructed deck of its own is (`generate`).
 *
 * The generator returns no deck where the pool holds no legal commander with colours to build
 * around ("no Commander deck from three Portal sets", in its own words), which is a pool too thin;
 * and it refuses a set it has not got in words. What comes back is held to what this table can deal:
 * a commander and a library that come to [size] exactly — the game's own deck size, its commander
 * counted (CR 903.5a), which the generator fills its library with basics to reach — every card a name
 * a deck may hold.
 */
private fun generateCommander(corpus: Corpus, codes: List<String>, format: DeckFormat, seed: Long, size: Int): Generated {
    val built = try {
        CommanderDeckGenerator(corpus.boosters, corpus.registry, kotlin.random.Random(seed)).generate(codes, format)
    } catch (e: IllegalArgumentException) {
        return Generated.Failed("thin", e.message)
    } catch (e: IllegalStateException) {
        return Generated.Failed("thin", e.message)
    } catch (e: Exception) {
        return Generated.Failed("failed", "${e::class.simpleName}: ${e.message}")
    } ?: return Generated.Failed("thin", "No legal commander with colours to build around.")
    val commander = built.commander ?: return Generated.Failed("failed", "It built a deck with no commander.")
    val lines = built.deckList.map { (key, n) -> generatedLine(key, n) }
    val came = lines.sumOf { it.count ?: 0 } + 1
    if (came != size) return Generated.Failed("thin", "The deck came to $came cards, where ${format.displayName} takes $size.")
    val strange = (lines.map { it.name } + commander).distinct().filter { resolveName(corpus, it) == null }
    if (strange.isNotEmpty()) return Generated.Failed("failed", "It chose ${strange.joinToString(", ")}, which a deck here cannot hold.")
    return Generated.Dealt(lines, Line(commander, 1, null, null))
}

/**
 * A seat's commander, from `new`'s player (protocol 8): a name, or `{"name", "set", "number"}` when a
 * printing was chosen for it, as a deck line names one. Null where none was sent.
 */
private fun commanderOf(v: JsonElement?): Line? = when (v) {
    is JsonPrimitive -> v.contentOrNull?.trim()?.takeIf { it.isNotEmpty() }?.let { Line(it, 1, null, null) }
    is JsonObject -> (v["name"] as? JsonPrimitive)?.contentOrNull?.trim()?.takeIf { it.isNotEmpty() }?.let {
        Line(it, 1, (v["set"] as? JsonPrimitive)?.contentOrNull, (v["number"] as? JsonPrimitive)?.contentOrNull)
    }
    else -> null
}

/**
 * The deck a seat the engine plays is dealt (protocol 7).
 *
 * A list of names is taken as it always was. `"mirror"` is the first person's deck and sideboard,
 * printings and all, which is what the relay has always sent as names. `"own"` asks Argentum to
 * build one: to the `format` given, from the `sets` given — the owner's fair fight, the sets the
 * person's own deck uses — or from the whole format where none are. Where it cannot, it falls back
 * rather than refuse a game somebody sat down to, and says so (`Built.fellBack`): from sets it has
 * not got, or too few cards in them, to the whole format; from a format it does not build to, or a
 * whole format it cannot build from either, to a copy of the person's deck.
 *
 * At a Commander table (protocol 8) every seat has a commander: a list of names brings its own as
 * `commander`, a copy is the person's with theirs, and a deck of its own is a Commander deck, its
 * commander chosen first by Argentum's `CommanderDeckGenerator`, falling back the same way. `game` is
 * the word of a Commander game being dealt, and null at a table dealt by the ordinary rules; since
 * protocol 10 a deck of its own is built to that game's own format and to no other — a Brawl deck at
 * a Brawl table — and at a Duel Commander table, which has no format to build to, is the copy.
 */
private fun deckFor(corpus: Corpus, o: JsonObject, name: String, person: Brought?, seed: Long, game: String? = null): Built {
    val commanderGame = game != null
    val deck = o["deck"]
    if (deck is JsonObject) return Built("deck", "deck", readLines(deck), readLines(o["sideboard"] as? JsonObject), commander = commanderOf(o["commander"]))
    val word = (deck as? JsonPrimitive)?.takeIf { it.isString }?.content
    val formatWord = o["format"]?.jsonPrimitive?.contentOrNull?.lowercase()
    // A copy is the whole of what the person brought: their deck, their sideboard, and at a Commander
    // table their commander, or the seat opposite would be dealt a Commander game with none.
    fun mirror(asked: String, fellBack: String? = null, why: String? = null, format: DeckFormat? = null): Built {
        val p = person ?: throw Refused("$name was to play a copy of a person's deck, and nobody at the table brought one.")
        return Built(asked, "mirror", p.lines, p.sideboard, formatWord.takeIf { asked == "own" }, format, fellBack = fellBack, why = why, commander = p.commander)
    }
    when (word) {
        "mirror" -> return mirror("mirror")
        "own" -> {}
        null -> throw Refused("$name has no deck.")
        else -> throw Refused("$name's deck is \"$word\", which is neither a list of cards, \"mirror\" nor \"own\".")
    }
    // Which builder, to which format: at a Commander table a Commander deck, commander and all; at any
    // other a constructed one. A Commander deck of its own is not built for a table dealt by the
    // ordinary rules, where it would have no command zone to begin in, so there the copy is dealt, as
    // every engine before protocol 8 dealt it.
    val builds = if (game != null) COMMANDER_BUILDS.filterKeys { it == game } else BUILDS
    val gameName = GAME_NAMES[game] ?: "Commander"
    val format = formatWord?.let(builds::get)
        ?: return mirror("own", "format", when {
            formatWord == null -> "No format was given."
            game != null && game !in COMMANDER_BUILDS -> "The engine builds no \"$game\" deck of its own."
            game != null -> "A $gameName game is dealt a $gameName deck of its own, and \"$formatWord\" is not one."
            formatWord in COMMANDER_BUILDS -> "A \"$formatWord\" deck of its own is built only for a ${GAME_NAMES[formatWord] ?: "Commander"} game."
            else -> "The engine builds no \"$formatWord\" deck of its own."
        })
    val size = GAME_FORMATS[game]?.deckSize ?: 0
    val build = { codes: List<String> -> if (commanderGame) generateCommander(corpus, codes, format, seed, size) else generate(corpus, codes, format, seed) }
    // Argentum's set codes are Scryfall's in capitals, as printings' are (pinOf). A list, even an
    // empty one, asks for the sets in it; no list asks for the whole format. An empty one is a
    // person's deck with no set to go by, and falls back as sets the engine has not got do.
    val setsAsked = o["sets"] is JsonArray
    val asked = (o["sets"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.contentOrNull?.trim()?.takeIf(String::isNotEmpty) }.distinctBy { it.uppercase() }
    val known = asked.map { it.uppercase() }.filter { it in corpus.boosters.availableSets }
    val missing = asked.filter { it.uppercase() !in corpus.boosters.availableSets }
    var fellBack: String? = null
    var why: String? = null
    if (setsAsked) {
        if (known.isEmpty()) {
            fellBack = "sets"
        } else when (val built = build(known)) {
            is Generated.Dealt -> return Built("own", "own", built.lines, formatWord = formatWord, format = format, from = "sets",
                sets = known.map(corpus.boosters.availableSets::getValue), missingSets = missing, commander = built.commander)
            is Generated.Failed -> { fellBack = built.code; why = built.why }
        }
    }
    return when (val built = build(emptyList())) {
        is Generated.Dealt -> Built("own", "own", built.lines, formatWord = formatWord, format = format, from = "format", missingSets = missing, fellBack = fellBack, why = why, commander = built.commander)
        is Generated.Failed -> mirror("own", fellBack ?: built.code, why ?: built.why, format)
    }
}

/** What a person brought to the table: their deck, their sideboard, and at a Commander table their commander. */
private class Brought(val lines: List<Line>, val sideboard: List<Line>, val commander: Line?)

/**
 * A deck's colours, in Argentum's order (white, blue, black, red, green), by the engine's own card
 * data: the colours its basic lands make, and for a deck with none, the colours of its spells.
 *
 * By the lands first because that is what a deck of the engine's own is — every one Argentum builds
 * has a manabase of basics alone, chosen for the colours it plays — and its spells can say more
 * than that. Measured on the first builds (PLAN.md, M5): a hybrid card counts as both its colours,
 * so a black-green deck holding Vibrance read as black, red and green, and Argentum's builder put
 * four Overlord of the Floodpits in a white-green deck with no Island to cast them. Named by
 * its spells, either would be called a colour it cannot play.
 *
 * A Commander deck's colours are its commander's colour identity (CR 903.4), which every card in it
 * must fit inside (CR 903.5c) and its basics are chosen from (protocol 8).
 */
private fun coloursOf(corpus: Corpus, lines: List<Line>, commander: Line? = null): List<Color> {
    commander?.let { c -> resolveName(corpus, c.name)?.let(corpus.registry::getCard) }?.let { card ->
        return Color.entries.filter { it in card.colorIdentity }
    }
    val cards = lines.mapNotNull { l -> resolveName(corpus, l.name)?.let(corpus.registry::getCard) }
    val basics = cards.filter { it.typeLine.isBasicLand }
    val seen = if (basics.isNotEmpty()) basics.flatMapTo(HashSet()) { it.colorIdentity } else cards.filterNot { it.isLand }.flatMapTo(HashSet()) { it.colors }
    return Color.entries.filter { it in seen }
}

private fun newTable(corpus: Corpus, params: JsonObject): Table {
    val registry = corpus.registry
    val players = params["players"]?.jsonArray ?: throw Refused("\"players\" is required.")
    if (players.size < 2) throw Refused("A game needs at least two players.")
    // The seed decides the shuffle, every coin flip and every other "at random",
    // so the same seed plays the same game. One is always chosen here and sent
    // back, which means any game, a failing test's included, can be played again
    // exactly. A chosen one stays below 2^53, because the relay reads it as a
    // JavaScript number and a larger Long would come back as a different game.
    // Chosen before any deck, because a deck of the engine's own is built from it.
    val seed = params["seed"]?.jsonPrimitive?.longOrNull ?: (Random().nextLong() ushr 11)
    // The game format (protocol 8): Commander where it is asked for, and the ordinary rules otherwise,
    // which is what every engine before this dealt whatever the decks' own format was. A word this
    // process deals no game in is refused rather than dealt by rules nobody asked for.
    val formatWord = (params["format"] as? JsonPrimitive)?.contentOrNull?.trim()?.lowercase() ?: "standard"
    val gameFormat = GAME_FORMATS[formatWord]
        ?: throw Refused("The engine deals no \"$formatWord\" game; it deals ${GAME_FORMATS.keys.map { "\"$it\"" }.let { it.dropLast(1).joinToString(", ") + " and " + it.last() }}.")
    val commanderGame = gameFormat.usesCommanders
    // Duel Commander and Brawl are games of two (protocol 10), refused in words at a table of more.
    if (formatWord in TWO_PLAYER_GAMES && players.size != 2) throw Refused("A ${GAME_NAMES[formatWord]} game is dealt to two players, and this one has ${players.size}.")
    val objects = players.map { it.jsonObject }
    val names = objects.mapIndexed { i, o -> o["name"]?.jsonPrimitive?.contentOrNull ?: "Player ${i + 1}" }
    val kinds = objects.map { playerOf(it) }
    // The deck of the first person to bring one, which is what an engine's seat mirrors: the deck
    // and its sideboard as they were sent, printings and all, and at a Commander table their commander.
    val person = objects.indices.firstOrNull { kinds[it].first == null && objects[it]["deck"] is JsonObject }?.let {
        Brought(readLines(objects[it]["deck"] as JsonObject), readLines(objects[it]["sideboard"] as? JsonObject),
            if (commanderGame) commanderOf(objects[it]["commander"]) else null)
    }
    // A person's deck is what they brought. A seat the engine plays may ask for a copy of theirs or
    // one of its own instead (protocol 7). Each engine seat's randomness is its own, so two seats
    // asking for a deck of their own at one table are not dealt the same one.
    val built = objects.mapIndexed { i, o -> if (kinds[i].first == null) null else deckFor(corpus, o, names[i], person, seed + i, formatWord.takeIf { commanderGame }) }
    val commanders = mutableListOf<String?>()
    val leftOutOfSideboards = mutableListOf<List<String>>()
    val printingsMissed = mutableListOf<List<String>>()
    val decks = mutableListOf<List<Line>>()
    val configs = objects.mapIndexed { i, o ->
        val name = names[i]
        val lines = built[i]?.lines ?: readLines(o["deck"] as? JsonObject ?: throw Refused("$name has no deck."))
        decks += lines
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
        val side = built[i]?.sideboard ?: readLines(o["sideboard"] as? JsonObject)
        side.firstOrNull { it.count == null }?.let { throw Refused("$name's sideboard lists ${it.name} without a number of copies.") }
        val (sideKnown, sideUnknown) = side.partition { resolveName(corpus, it.name) != null }
        leftOutOfSideboards += sideUnknown.map { it.name }.distinct()
        val sideboard = sideKnown.flatMap { l -> resolveName(corpus, l.name)!!.let { card -> List(l.count!!) { CardEntry(card, pinOf(corpus, l, card)) } } }
        // At a Commander table, the seat's commander (protocol 8): dealt face up into the command zone
        // and not into the library (CR 903.6), under the name the engine knows it by, in the printing
        // named where the engine has it. Argentum deals no Commander game with a player who has none,
        // so neither does this, and says whose; at any other table a commander sent is not read.
        val commanderLine = if (commanderGame) built[i]?.commander ?: commanderOf(o["commander"]) else null
        val commander = commanderLine?.let { c -> resolveName(corpus, c.name) ?: throw Refused("The engine does not know $name's commander, ${c.name}.") }
        if (commanderGame && commander == null) throw Refused("$name has no commander, and every player in a Commander game has one.")
        commanders += commander
        // A printing named but not held: said once per card, so the table can say whose art it wears.
        printingsMissed += (lines + sideKnown + listOfNotNull(commanderLine))
            .filter { it.set != null && it.number != null }
            .mapNotNull { l -> resolveName(corpus, l.name)?.takeIf { pinOf(corpus, l, it) == null } }
            .distinct()
        PlayerConfig(
            name = name,
            deck = Deck.fromEntries(entries, commander = commander, commanderPrinting = commander?.let { pinOf(corpus, commanderLine!!, it) }, sideboard = sideboard),
            startingLife = o["life"]?.jsonPrimitive?.int ?: 20,
            commanderCardName = commander,
        )
    }
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
        format = gameFormat,
    ))
    env.restore(dealt.state, dealt.playerIds)
    val seats = env.playerIds.mapIndexed { i, id ->
        val o = objects[i]
        val (ai, profile, level) = kinds[i]
        // The decisions a person's client said it can show, of those this process can ask. A word
        // it does not know — a newer client's — is not asked, and not a reason to refuse the game.
        val answers = (o["answers"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.filter { it in ASKABLE }
        Seat(id, configs[i].name, ai, o["autoPass"]?.jsonPrimitive?.boolean ?: false, leftOutOfSideboards[i], printingsMissed[i], profile, level,
            asks = if (ai == null) ALWAYS_ASKED + answers else emptySet(), dealt = decks[i], built = built[i], commander = commanders[i])
    }
    return Table(registry, env, seats, seed, pacedBy(params), dealt.events, opening, formatWord)
}

/**
 * What a seat the engine plays was dealt, and how (protocol 7): never its cards, which are as hidden
 * from the person opposite as any opponent's deck, but what they are made of — how many, what colours,
 * and for a deck of its own, the format and the sets. A Commander deck counts its commander among its
 * cards (CR 903.5a), and is named by its commander's colours. A seat in a game taken back from a
 * snapshot (protocol 9) says what it was said to be at the deal, since its builder did not travel.
 */
private fun deckReport(s: Seat, corpus: Corpus): JsonObject? = s.report ?: s.built?.let { b ->
    buildJsonObject {
        put("asked", b.asked); put("played", b.played)
        put("cards", b.lines.sumOf { it.count ?: 0 } + (if (s.commander != null) 1 else 0))
        putJsonArray("colours") { coloursOf(corpus, b.lines, b.commander.takeIf { s.commander != null }).forEach { add(JsonPrimitive(it.symbol.toString())) } }
        s.commander?.let { put("commander", it) }
        b.formatWord?.let { put("format", it) }
        b.format?.let { put("formatName", it.displayName) }
        b.from?.let { put("from", it) }
        if (b.sets.isNotEmpty()) putJsonArray("sets") { b.sets.forEach { set -> add(buildJsonObject { put("code", set.setCode); put("name", set.setName) }) } }
        if (b.missingSets.isNotEmpty()) putJsonArray("missingSets") { b.missingSets.forEach { add(JsonPrimitive(it)) } }
        b.fellBack?.let { put("fellBack", it) }
        b.why?.let { put("why", it) }
    }
}

/**
 * A game kept by `Table.snapshot`, taken back into this process (protocol 9): the state installed as
 * the deal installs one (`env.restore`), the seats as they were, each seat's log as it had been told,
 * and the stop found again (`Table.settle`). Everything is checked before anything is kept, and a text
 * that is not a game this engine wrote, or one it cannot read, is refused in words: a relay that asked
 * has a room of people waiting on the answer, and "could not come back, because …" is one it can give.
 */
private fun restoreTable(corpus: Corpus, text: String): Table {
    val doc = try { snapshotJson.parseToJsonElement(text).jsonObject } catch (e: Exception) {
        throw Refused("That snapshot could not be read: ${e.message}")
    }
    if ((doc["kind"] as? JsonPrimitive)?.contentOrNull != SNAPSHOT_KIND) throw Refused("That is not a game this engine kept.")
    val version = (doc["version"] as? JsonPrimitive)?.intOrNull
    if (version != SNAPSHOT_VERSION) throw Refused("That game was kept in the shape of version $version, and this engine reads version $SNAPSHOT_VERSION.")
    val state = try { snapshotJson.decodeFromJsonElement(GameState.serializer(), doc["state"] ?: JsonNull) } catch (e: Exception) {
        throw Refused("The game in that snapshot could not be read: ${e.message}")
    }
    val string = { o: JsonObject, key: String -> (o[key] as? JsonPrimitive)?.contentOrNull }
    val strings = { v: JsonElement? -> (v as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.contentOrNull } }
    val playerIds = strings(doc["playerIds"]).map(::EntityId)
    if (playerIds.isEmpty() || playerIds.any { state.getEntity(it) == null }) throw Refused("That snapshot's players are not in its game.")
    val seats = (doc["seats"] as? JsonArray).orEmpty().map { v ->
        val o = v as? JsonObject ?: throw Refused("That snapshot's seats could not be read.")
        val id = string(o, "id")?.let(::EntityId) ?: throw Refused("A seat in that snapshot has no id.")
        val profileId = string(o, "profile")
        Seat(
            id = id,
            name = string(o, "name") ?: id.value,
            ai = string(o, "ai"),
            autoPass = (o["autoPass"] as? JsonPrimitive)?.booleanOrNull ?: false,
            sideboardLeftOut = strings(o["sideboardLeftOut"]),
            unknownPrintings = strings(o["unknownPrintings"]),
            // A profile is kept by Argentum's id for it; one this engine does not list is refused
            // rather than played as another, as `new` refuses one.
            profile = profileId?.let { PROFILES[it] ?: throw Refused("That game's engine played as \"$it\", a profile this engine does not have.") },
            level = string(o, "level"),
            asks = strings(o["asks"]).toSet(),
            dealt = (o["dealt"] as? JsonArray).orEmpty().mapNotNull { l ->
                (l as? JsonObject)?.let { Line(string(it, "name") ?: return@mapNotNull null, (it["count"] as? JsonPrimitive)?.intOrNull, string(it, "set"), string(it, "number")) }
            },
            commander = string(o, "commander"),
            report = o["deck"] as? JsonObject,
        )
    }
    if (seats.map { it.id } != playerIds) throw Refused("That snapshot's seats are not its game's players.")
    val env = GameEnvironment.create(corpus.registry)
    env.restore(state, playerIds, (doc["stepCount"] as? JsonPrimitive)?.intOrNull ?: 0)
    val format = string(doc, "format")?.takeIf { it in GAME_FORMATS } ?: "standard"
    val table = Table(
        corpus.registry, env, seats,
        seed = (doc["seed"] as? JsonPrimitive)?.longOrNull ?: 0L,
        paced = (doc["paced"] as? JsonPrimitive)?.booleanOrNull ?: false,
        opening = (doc["opening"] as? JsonPrimitive)?.booleanOrNull ?: false,
        format = format,
    )
    val logs = doc["logs"] as? JsonObject
    for (s in seats) {
        table.logs[s.id] = (logs?.get(s.id.value) as? JsonArray).orEmpty().mapTo(mutableListOf()) { v ->
            val o = v as? JsonObject ?: throw Refused("A line of that game's log could not be read.")
            val event = try { snapshotJson.decodeFromJsonElement(ClientEvent.serializer(), o["event"] ?: JsonNull) } catch (e: Exception) {
                throw Refused("A line of that game's log could not be read: ${e.message}")
            }
            LogLine(event, string(o, "step")?.let { name -> Step.entries.firstOrNull { it.name == name } })
        }
    }
    table.step = string(doc, "step")?.let { name -> Step.entries.firstOrNull { it.name == name } }
    table.pausedAfter = string(doc, "pausedAfter")?.let(::EntityId)?.takeIf { id -> seats.any { it.id == id && it.ai != null } }
    table.settle()
    return table
}

private fun seatsOf(table: Table, corpus: Corpus): JsonArray = buildJsonArray {
    table.seats.forEach { s ->
        add(buildJsonObject {
            put("id", s.id.value); put("name", s.name); put("ai", s.ai); put("autoPass", s.autoPass)
            // What the seat plays with, said only for a seat the engine plays: the level it
            // took, if it was asked for one it has, and Argentum's own id for the profile.
            if (s.profile != null) { put("level", s.level); put("profile", s.profile.id) }
            // What a person will be asked rather than have answered for them, so the relay can
            // tell their client which of its prompts will ever be shown.
            if (s.ai == null) putJsonArray("asked") { ASKABLE.filter { it in s.asks }.forEach { add(JsonPrimitive(it)) } }
            // At a Commander table, the seat's commander (protocol 8). Said for every seat, the
            // engine's too: a commander begins the game face up in the command zone (CR 903.6), so
            // it is on the table for everybody to see, where the rest of a deck is not.
            s.commander?.let { put("commander", it) }
            deckReport(s, corpus)?.let { put("deck", it) }
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
                    // The game formats it deals (protocol 8), by the word `new` takes.
                    putJsonArray("formats") { GAME_FORMATS.keys.forEach { add(JsonPrimitive(it)) } }
                    // The formats an engine's seat can be dealt a deck of its own in (protocol 7),
                    // by Scryfall's word for each; since protocol 8 Commander's too, at a Commander table.
                    putJsonObject("decks") { putJsonArray("formats") { (BUILDS.keys + COMMANDER_BUILDS.keys).forEach { add(JsonPrimitive(it)) } } }
                    // Measured, not assumed: what loading the corpus took and holds.
                    putJsonObject("load") {
                        put("ms", corpus.loadMs); put("legalitiesMs", corpus.legalMs); put("heapMb", corpus.heapMb); put("maxHeapMb", Runtime.getRuntime().maxMemory() / MB)
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
                    JsonObject(t.status() + mapOf("seats" to seatsOf(t, corpus), "seed" to JsonPrimitive(t.seed)) +
                        (if (t.paced) mapOf("paced" to JsonPrimitive(true)) else emptyMap()) +
                        (if (t.opening) mapOf("mulligans" to JsonPrimitive(true)) else emptyMap()) +
                        (if (t.format != "standard") mapOf("format" to JsonPrimitive(t.format)) else emptyMap()) +
                        // What a Commander game holds a player to, off the game dealt (protocol 10).
                        (rulesOf(t.env.state.format)?.let { mapOf("rules" to it) } ?: emptyMap()))
                }
                // The game as it stands, as text (protocol 9): the relay keeps it beside the room and
                // gives it back to a fresh process with `restore`. Text rather than JSON on the wire,
                // because the game's random number generator is a 64-bit number and a relay that read
                // it as JavaScript would round it. `bytes` is its length, for measuring what is kept.
                "snapshot" -> {
                    val t = table ?: throw Refused("No game yet. Send \"new\" first.")
                    val text = t.snapshot(corpus)
                    buildJsonObject { put("ok", true); put("snapshot", text); put("bytes", text.toByteArray(Charsets.UTF_8).size) }
                }
                // A kept game taken back, into a process that holds none yet (protocol 9), answered as
                // `new` is answered, at the stop it was kept at. Refused into a process that holds one,
                // so a game is never quietly replaced under the people playing it; `replace: true` is
                // for measuring and tests, which take several kept games back into one process rather
                // than wait out the corpus loading for each, and the relay never sends it.
                "restore" -> {
                    val replace = (req["replace"] as? JsonPrimitive)?.booleanOrNull == true
                    if (table != null && !replace) throw Refused("This engine already holds a game; a kept game is taken back by a fresh one.")
                    val text = (req["snapshot"] as? JsonPrimitive)?.takeIf { it.isString }?.content
                        ?: throw Refused("\"snapshot\" is required: the text a \"snapshot\" answered.")
                    val t = restoreTable(corpus, text)
                    table = t
                    JsonObject(t.status() + mapOf("seats" to seatsOf(t, corpus), "seed" to JsonPrimitive(t.seed), "restored" to JsonPrimitive(true)) +
                        (if (t.paced) mapOf("paced" to JsonPrimitive(true)) else emptyMap()) +
                        (if (t.opening) mapOf("mulligans" to JsonPrimitive(true)) else emptyMap()) +
                        (if (t.format != "standard") mapOf("format" to JsonPrimitive(t.format)) else emptyMap()) +
                        (rulesOf(t.env.state.format)?.let { mapOf("rules" to it) } ?: emptyMap()))
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
                // The deck a seat was dealt, card by card, with what the engine's own card data says
                // of each: its type line, its cost, its colours, the formats it is legal in. For measuring and
                // for tests, which hold a deck of the engine's own to the app's validator; never sent
                // by the relay, since the engine's deck is as hidden as any opponent's.
                "decklist" -> {
                    val t = table ?: throw Refused("No game yet.")
                    val wanted = req["seat"]?.jsonPrimitive?.contentOrNull ?: throw Refused("\"seat\" is required.")
                    val seat = t.seats.firstOrNull { it.id.value == wanted } ?: throw Refused("No seat $wanted.")
                    buildJsonObject {
                        put("ok", true)
                        // At a Commander table the commander is dealt apart from the deck, into the
                        // command zone, and is said apart here too (protocol 8).
                        seat.commander?.let { put("commander", it) }
                        putJsonObject("deck") {
                            for ((name, lines) in seat.dealt.groupBy { it.name }) {
                                val shaped = lines.map { l -> if (l.set != null && l.number != null) buildJsonObject { put("count", l.count); put("set", l.set); put("number", l.number) } else JsonPrimitive(l.count) }
                                put(name, if (shaped.size == 1) shaped.single() else JsonArray(shaped))
                            }
                        }
                        putJsonArray("cards") {
                            for (name in (seat.dealt.map { it.name } + listOfNotNull(seat.commander)).distinct()) {
                                val card = resolveName(corpus, name)?.let(corpus.registry::getCard) ?: continue
                                add(buildJsonObject {
                                    put("name", name); put("typeLine", card.typeLine.toString()); put("manaCost", card.manaCost.toString())
                                    putJsonArray("colours") { Color.entries.filter { it in card.colors }.forEach { add(JsonPrimitive(it.symbol.toString())) } }
                                    // Its colour identity (CR 903.4), which a Commander deck is held to (protocol 8).
                                    putJsonArray("identity") { Color.entries.filter { it in card.colorIdentity }.forEach { add(JsonPrimitive(it.symbol.toString())) } }
                                    putJsonArray("legal") { DeckFormat.entries.filter { it in card.legalFormats }.forEach { add(JsonPrimitive(it.scryfallKey)) } }
                                })
                            }
                        }
                    }
                }
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
