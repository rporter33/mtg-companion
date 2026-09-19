package spike

import com.wingedsheep.engine.core.GameConfig
import com.wingedsheep.engine.core.PlayerConfig
import com.wingedsheep.engine.registry.CardRegistry
import com.wingedsheep.engine.view.ClientGameState
import com.wingedsheep.engine.view.ClientStateTransformer
import com.wingedsheep.engine.view.StateDelta
import com.wingedsheep.engine.view.StateDiffCalculator
import com.wingedsheep.gym.GameEnvironment
import com.wingedsheep.mtg.sets.definitions.por.PortalSet
import com.wingedsheep.sdk.model.Deck
import kotlinx.serialization.json.Json

/**
 * Part two of the spike: what actually goes over the wire.
 *
 * The first run showed that `GameState` cannot be serialised naively — it is an
 * ECS whose components are polymorphic, and encoding it throws. That is not a
 * flaw; it is why the engine ships `view/`. The real protocol is:
 *
 *     GameState  --ClientStateTransformer.transform(state, viewer)-->  ClientGameState
 *     ClientGameState (prev, next)  --StateDiffCalculator.computeDelta-->  StateDelta
 *
 * Both DTOs are @Serializable. So this measures the three numbers a client
 * architecture actually depends on: what a full state costs, what a delta
 * costs, and what the transform costs to compute.
 *
 * It also proves the thing `TARGET.md` §9 needs: that the transform is
 * per-viewer and hides what that viewer may not see.
 */
fun main() {
    val json = Json { encodeDefaults = false }
    val reg = CardRegistry().apply {
        register(PortalSet.cards)
        register(PortalSet.basicLands)
    }
    val transformer = ClientStateTransformer(reg)

    val env = GameEnvironment.create(reg)
    env.reset(
        GameConfig(
            players = listOf(
                PlayerConfig("Alice", Deck.of("Mountain" to 14, "Raging Goblin" to 12)),
                PlayerConfig("Bob", Deck.of("Mountain" to 14, "Raging Goblin" to 12)),
            ),
            skipMulligans = true,
            startingPlayerIndex = 0,
        )
    )
    val alice = env.playerIds[0]
    val bob = env.playerIds[1]

    println("=".repeat(72))
    println("SPIKE PART 2 — THE WIRE")
    println("=".repeat(72))

    // ---- visibility: the thing TARGET.md section 9 depends on ----------
    val aliceView = transformer.transform(env.state, alice)
    val bobView = transformer.transform(env.state, bob)
    println("\n[1] PER-VIEWER VISIBILITY (hidden information)")
    fun handKnown(view: ClientGameState, owner: com.wingedsheep.sdk.model.EntityId): Pair<Int, Int> {
        val hand = view.zones.firstOrNull {
            it.zoneId.zoneType.name == "HAND" && it.zoneId.ownerId == owner
        } ?: return 0 to 0
        val named = hand.cardIds.count { id -> view.cards[id]?.name?.isNotBlank() == true }
        return hand.size to named
    }
    val (aOwnSize, aOwnNamed) = handKnown(aliceView, alice)
    val (aOppSize, aOppNamed) = handKnown(aliceView, bob)
    println("    Alice sees her own hand:      $aOwnSize cards, $aOwnNamed with a name")
    println("    Alice sees Bob's hand:        $aOppSize cards, $aOppNamed with a name")
    println("    -> the opponent's hand arrives as opaque ids. That is the log rule in")
    println("       TARGET.md section 9 handed to us, not something we have to enforce.")

    // ---- size, and what a delta saves ----------------------------------
    println("\n[2] PAYLOAD SIZE OVER A REAL GAME")
    var prev: ClientGameState? = null
    val fullSizes = mutableListOf<Int>()
    val deltaSizes = mutableListOf<Int>()
    val transformNanos = mutableListOf<Long>()

    var steps = 0
    while (!env.isTerminal && steps < 400) {
        val actor = env.agentToAct ?: break
        if (env.pendingDecision == null) {
            val t0 = System.nanoTime()
            val view = transformer.transform(env.state, actor)
            transformNanos += System.nanoTime() - t0

            val fullJson = json.encodeToString(ClientGameState.serializer(), view)
            fullSizes += fullJson.length
            prev?.let { p ->
                val delta = StateDiffCalculator.computeDelta(p, view)
                deltaSizes += json.encodeToString(StateDelta.serializer(), delta).length
            }
            prev = view
        }
        val actions = env.legalActions()
        if (actions.isEmpty()) break
        val affordable = actions.filter { it.affordable }
        env.step((if (affordable.isEmpty()) actions else affordable).random().action)
        steps++
    }

    fun report(label: String, xs: List<Int>) {
        if (xs.isEmpty()) { println("    $label: no samples"); return }
        val s = xs.sorted()
        println(
            "    %-22s n=%-5d median %6d B   p90 %6d B   max %6d B".format(
                label, s.size, s[s.size / 2], s[(s.size * 0.9).toInt().coerceAtMost(s.size - 1)], s.last()
            )
        )
    }
    println("    stepped $steps actions, reached turn ${env.turnNumber}")
    report("full ClientGameState", fullSizes)
    report("StateDelta", deltaSizes)
    if (fullSizes.isNotEmpty() && deltaSizes.isNotEmpty()) {
        val fm = fullSizes.sorted()[fullSizes.size / 2].toDouble()
        val dm = deltaSizes.sorted()[deltaSizes.size / 2].toDouble()
        println("    -> a delta is %.1f%% the size of a full push".format(100.0 * dm / fm))
    }

    println("\n[3] COST OF BUILDING A VIEW")
    if (transformNanos.isNotEmpty()) {
        val t = transformNanos.sorted()
        println("    transform() median %.1f µs, p90 %.1f µs, max %.1f µs".format(
            t[t.size / 2] / 1000.0,
            t[(t.size * 0.9).toInt().coerceAtMost(t.size - 1)] / 1000.0,
            t.last() / 1000.0,
        ))
    }

    println("\n" + "=".repeat(72))
}
