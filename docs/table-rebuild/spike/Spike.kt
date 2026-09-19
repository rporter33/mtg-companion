package spike

import com.wingedsheep.engine.core.GameAction
import com.wingedsheep.engine.core.GameConfig
import com.wingedsheep.engine.core.PendingDecision
import com.wingedsheep.engine.core.PlayerConfig
import com.wingedsheep.engine.legalactions.LegalAction
import com.wingedsheep.engine.registry.CardRegistry
import com.wingedsheep.engine.state.GameState
import com.wingedsheep.gym.ActionSelector
import com.wingedsheep.gym.GameEnvironment
import com.wingedsheep.gym.RandomActionSelector
import com.wingedsheep.mtg.sets.definitions.por.PortalSet
import com.wingedsheep.sdk.model.Deck
import kotlinx.serialization.json.Json

/**
 * The integration spike for mtg-companion's Table rebuild.
 *
 * Three questions, and nothing else:
 *
 *  1. Does a whole game run through this engine from a clean clone?
 *  2. `FRICTION.md` Law 1 says the client must never stop at a priority window
 *     where the player can do nothing. So: what fraction of windows are
 *     exactly that, and how much does it cost to ask?
 *  3. How big is the game state, i.e. what does a WebSocket update cost?
 */

/** One priority window, as the engine offered it. */
private data class Window(
    val turn: Int,
    val phase: String,
    val step: String,
    val actions: Int,
    val nonPass: Int,
    val affordableNonPass: Int,
    val nanos: Long,
)

/**
 * Wraps a selector and records every window it is asked about.
 *
 * `playGame` hands the already-computed legal actions to `selectAction`, so the
 * counts are free. The timing recomputes them at the same state — the same work
 * the client would do when it asks "can this player act?", which is the number
 * Law 1 actually depends on.
 */
private class Recorder(
    private val env: GameEnvironment,
    private val inner: ActionSelector,
) : ActionSelector {
    val windows = mutableListOf<Window>()

    override fun selectAction(state: GameState, legalActions: List<LegalAction>): GameAction {
        val t0 = System.nanoTime()
        env.legalActions()
        val nanos = System.nanoTime() - t0

        val nonPass = legalActions.count { it.actionType != "PassPriority" }
        windows += Window(
            turn = state.turnNumber,
            phase = state.phase.name,
            step = state.step.name,
            actions = legalActions.size,
            nonPass = nonPass,
            affordableNonPass = legalActions.count { it.actionType != "PassPriority" && it.affordable },
            nanos = nanos,
        )
        return inner.selectAction(state, legalActions)
    }

    override fun respondToDecision(state: GameState, decision: PendingDecision) =
        inner.respondToDecision(state, decision)
}

private fun registry(): CardRegistry = CardRegistry().apply {
    register(PortalSet.cards)
    register(PortalSet.basicLands)
}

/** A deliberately plain deck, so the shape of the answer is about the engine and not the cards. */
private fun deck() = Deck.of(
    "Mountain" to 14,
    "Raging Goblin" to 12,
    "Hand of Death" to 0,
)

private fun pct(n: Int, of: Int) = if (of == 0) "—" else "%.1f%%".format(100.0 * n / of)

fun main() {
    println("=".repeat(72))
    println("ARGENTUM INTEGRATION SPIKE — mtg-companion Table rebuild")
    println("=".repeat(72))

    // ---- 1. Does a game run at all? ------------------------------------
    val reg = registry()
    println("\n[1] REGISTRY")
    println("    Portal cards registered: ${PortalSet.cards.size} + ${PortalSet.basicLands.size} basic lands")

    val allWindows = mutableListOf<Window>()
    var completed = 0
    var totalTurns = 0
    var totalSteps = 0
    val gameMillis = mutableListOf<Long>()

    val GAMES = 20
    println("\n[2] PLAYING $GAMES FULL GAMES (seeded, two random agents)")

    for (g in 0 until GAMES) {
        val env = GameEnvironment.create(reg)
        val rec = Recorder(env, RandomActionSelector(java.util.Random(1000L + g)))
        val config = GameConfig(
            players = listOf(
                PlayerConfig("Alice", deck()),
                PlayerConfig("Bob", deck()),
            ),
            skipMulligans = true,
            startingPlayerIndex = 0,
        )
        // Both seats recorded, so the statistics cover the opponent's turns too —
        // which is exactly where Moxgate's "Nothing to respond with" clicks land.
        val ids = GameEnvironment.create(reg).let { it }
        val t0 = System.currentTimeMillis()
        val result = try {
            env.reset(config)
            val agents = env.playerIds.associateWith { rec as ActionSelector }
            env.playGame(config, agents)
        } catch (e: Throwable) {
            println("    game $g FAILED: ${e::class.simpleName}: ${e.message}")
            continue
        }
        gameMillis += System.currentTimeMillis() - t0
        if (result.terminated) completed++
        totalTurns += result.info.turnNumber
        totalSteps += result.info.stepCount
        allWindows += rec.windows
        rec.windows.clear()
        if (ids.stepCount < 0) println("unreachable")
    }

    println("    games that reached a natural end: $completed / $GAMES")
    println("    average turns per game:           ${if (GAMES > 0) totalTurns / GAMES else 0}")
    println("    average engine steps per game:    ${if (GAMES > 0) totalSteps / GAMES else 0}")
    if (gameMillis.isNotEmpty()) {
        println("    wall clock per game:              ${gameMillis.average().toInt()} ms " +
            "(min ${gameMillis.min()}, max ${gameMillis.max()})")
    }

    // ---- 2. FRICTION.md Law 1 ------------------------------------------
    println("\n[3] LAW 1 — HOW MANY PRIORITY WINDOWS ARE NON-EVENTS?")
    val total = allWindows.size
    val deadWindows = allWindows.count { it.nonPass == 0 }
    val noAffordable = allWindows.count { it.affordableNonPass == 0 }
    println("    priority windows offered:              $total")
    println("    windows where PASS is the ONLY action: $deadWindows  (${pct(deadWindows, total)})")
    println("    windows with nothing AFFORDABLE:       $noAffordable  (${pct(noAffordable, total)})")
    println()
    println("    Every one of those is a click Moxgate asks for and we do not.")

    println("\n    By step (windows / dead / % dead):")
    allWindows.groupBy { "${it.phase}.${it.step}" }
        .entries
        .sortedByDescending { it.value.size }
        .take(16)
        .forEach { (k, v) ->
            val dead = v.count { it.nonPass == 0 }
            println("      %-34s %6d %6d  %s".format(k, v.size, dead, pct(dead, v.size)))
        }

    // ---- 3. Is asking cheap enough to do every window? ------------------
    println("\n[4] COST OF ASKING — legalActions() at real game states")
    val times = allWindows.map { it.nanos }.sorted()
    if (times.isNotEmpty()) {
        fun q(p: Double) = times[(times.size * p).toInt().coerceAtMost(times.size - 1)] / 1000.0
        println("    samples: ${times.size}")
        println("    median:  %.1f µs".format(q(0.50)))
        println("    p90:     %.1f µs".format(q(0.90)))
        println("    p99:     %.1f µs".format(q(0.99)))
        println("    max:     %.1f µs".format(times.last() / 1000.0))
        println()
        println("    Law 1 asks this once per window. A 60fps frame is 16,667 µs.")
    }

    // ---- 4. What does a state update cost on the wire? ------------------
    println("\n[5] STATE SIZE — what a WebSocket update would carry")
    val env = GameEnvironment.create(reg)
    env.reset(
        GameConfig(
            players = listOf(PlayerConfig("Alice", deck()), PlayerConfig("Bob", deck())),
            skipMulligans = true,
            startingPlayerIndex = 0,
        )
    )
    repeat(120) {
        if (env.isTerminal) return@repeat
        val a = env.legalActions()
        if (a.isEmpty()) return@repeat
        env.step(a.first { it.affordable }.action)
    }
    println("    after ${env.stepCount} steps: turn ${env.turnNumber}, " +
        "${env.state.entities.size} entities, ${env.state.zones.size} zones")
    try {
        val json = Json { encodeDefaults = false; ignoreUnknownKeys = true }
        val encoded = json.encodeToString(GameState.serializer(), env.state)
        println("    full GameState as JSON: ${encoded.length / 1024} KB (${encoded.length} bytes)")
        println("    -> a full-state push per action would be too heavy; the engine's")
        println("       view/StateDiffCalculator + StateDelta exist for exactly this.")
    } catch (e: Throwable) {
        println("    GameState JSON encode not attempted here: ${e::class.simpleName}: ${e.message}")
    }

    println("\n" + "=".repeat(72))
    println("DONE")
    println("=".repeat(72))
}
