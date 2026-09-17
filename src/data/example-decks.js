// Example decks.
//
// Real decklists cannot be fetched: no deckbuilding site publishes a browser-
// readable API, and inventing a hundred-card list and presenting it as a good
// deck would be worse than shipping none. So examples are supplied by a person
// who plays, and the app makes that easy — paste a deck in, mark it as an
// example, and export the file contents to be shipped here.
//
// FORMAT: card NAMES, never printing ids. A printing id pins an example to one
// art from one set and breaks when that printing is not in the cache; a name
// resolves against whatever printing the player has. Names are also the thing a
// human can read and check.
//
// Each entry carries who chose it and when, because an example deck is an
// opinion and the reader deserves to know whose.

export const EXAMPLE_DECKS = [
  // Nothing shipped yet. Paste a deck into the importer, open its Import /
  // export tab and use "Copy as example" to produce an entry to paste here.
  {
    id: "y-shtola-night-s-blessed",
    name: "Y'shtola, Night's Blessed",
    formatId: "commander",
    commanders: ["Y'shtola, Night's Blessed"],
    signatureSpell: null,
    credit: "Rob Porter",
    note: "",
    addedAt: "2026-09-17",
    main: [
      { name: "Alisaie Leveilleur", quantity: 1 },
      { name: "Alphinaud Leveilleur", quantity: 1 },
      { name: "Arcane Sanctum", quantity: 1 },
      { name: "Arcane Signet", quantity: 1 },
      { name: "Archaeomancer's Map", quantity: 1 },
      { name: "Archmage Emeritus", quantity: 1 },
      { name: "Ardbert, Warrior of Darkness", quantity: 1 },
      { name: "Ash Barrens", quantity: 1 },
      { name: "Astrologian's Planisphere", quantity: 1 },
      { name: "Authority of the Consuls", quantity: 1 },
      { name: "Baleful Strix", quantity: 1 },
      { name: "Bastion of Remembrance", quantity: 1 },
      { name: "Blue Mage's Cane", quantity: 1 },
      { name: "Champions from Beyond", quantity: 1 },
      { name: "Choked Estuary", quantity: 1 },
      { name: "Circle of Power", quantity: 1 },
      { name: "Cleansing Nova", quantity: 1 },
      { name: "Command Tower", quantity: 1 },
      { name: "Contaminated Aquifer", quantity: 1 },
      { name: "Coveted Jewel", quantity: 1 },
      { name: "Crux of Fate", quantity: 1 },
      { name: "Cut a Deal", quantity: 1 },
      { name: "Dancer's Chakrams", quantity: 1 },
      { name: "Darkwater Catacombs", quantity: 1 },
      { name: "Demolition Field", quantity: 1 },
      { name: "Desolate Mire", quantity: 1 },
      { name: "Dig Through Time", quantity: 1 },
      { name: "Drowned Catacomb", quantity: 1 },
      { name: "Emet-Selch of the Third Seat", quantity: 1 },
      { name: "Estinien Varlineau", quantity: 1 },
      { name: "Evolving Wilds", quantity: 1 },
      { name: "Exotic Orchard", quantity: 1 },
      { name: "Exsanguinate", quantity: 1 },
      { name: "Eye of Nidhogg", quantity: 1 },
      { name: "Fandaniel, Telophoroi Ascian", quantity: 1 },
      { name: "Fetid Heath", quantity: 1 },
      { name: "Final Judgment", quantity: 1 },
      { name: "G'raha Tia, Scion Reborn", quantity: 1 },
      { name: "Glacial Fortress", quantity: 1 },
      { name: "Hermes, Overseer of Elpis", quantity: 1 },
      { name: "Hildibrand Manderville", quantity: 1 },
      { name: "Hraesvelgr of the First Brood", quantity: 1 },
      { name: "Hypnotic Sprite", quantity: 1 },
      { name: "Idyllic Beachfront", quantity: 1 },
      { name: "Into the Story", quantity: 1 },
      { name: "Island", quantity: 3 },
      { name: "Isolated Chapel", quantity: 1 },
      { name: "Krile Baldesion", quantity: 1 },
      { name: "Lethal Scheme", quantity: 1 },
      { name: "Lingering Souls", quantity: 1 },
      { name: "Lyse Hext", quantity: 1 },
      { name: "Murderous Rider", quantity: 1 },
      { name: "Observed Stasis", quantity: 1 },
      { name: "Papalymo Totolymo", quantity: 1 },
      { name: "Path of Ancestry", quantity: 1 },
      { name: "Plains", quantity: 4 },
      { name: "Port Town", quantity: 1 },
      { name: "Prairie Stream", quantity: 1 },
      { name: "Propaganda", quantity: 1 },
      { name: "Reaper's Scythe", quantity: 1 },
      { name: "Relic of Legends", quantity: 1 },
      { name: "Rite of Replication", quantity: 1 },
      { name: "Sage's Nouliths", quantity: 1 },
      { name: "Scavenger Grounds", quantity: 1 },
      { name: "Shineshadow Snarl", quantity: 1 },
      { name: "Skycloud Expanse", quantity: 1 },
      { name: "Snuff Out", quantity: 1 },
      { name: "Sol Ring", quantity: 1 },
      { name: "Sublime Epiphany", quantity: 1 },
      { name: "Summon: Good King Mog XII", quantity: 1 },
      { name: "Sunken Hollow", quantity: 1 },
      { name: "Sunken Ruins", quantity: 1 },
      { name: "Sunlit Marsh", quantity: 1 },
      { name: "Swamp", quantity: 4 },
      { name: "Swords to Plowshares", quantity: 1 },
      { name: "Syphon Mind", quantity: 1 },
      { name: "Talisman of Dominance", quantity: 1 },
      { name: "Talisman of Hierarchy", quantity: 1 },
      { name: "Talisman of Progress", quantity: 1 },
      { name: "Tataru Taru", quantity: 1 },
      { name: "Temple of the False God", quantity: 1 },
      { name: "Thancred Waters", quantity: 1 },
      { name: "Thought Vessel", quantity: 1 },
      { name: "Tome of Legends", quantity: 1 },
      { name: "Torrential Gearhulk", quantity: 1 },
      { name: "Transpose", quantity: 1 },
      { name: "Underground River", quantity: 1 },
      { name: "Urianger Augurelt", quantity: 1 },
      { name: "Vindicate", quantity: 1 },
      { name: "Void Rend", quantity: 1 },
      { name: "White Auracite", quantity: 1 },
    ],
    sideboard: [],
  },
  {
    id: "esika-god-of-the-tree",
    name: "Esika, God of the Tree",
    formatId: "commander",
    commanders: ["Esika, God of the Tree"],
    signatureSpell: null,
    credit: "Rob Porter",
    note: "",
    addedAt: "2026-09-17",
    main: [
      { name: "Altar of the Pantheon", quantity: 1 },
      { name: "Arcane Signet", quantity: 1 },
      { name: "Archangel Avacyn", quantity: 1 },
      { name: "Arlinn Kord", quantity: 1 },
      { name: "Arlinn, the Pack's Hope", quantity: 1 },
      { name: "Azor's Gateway", quantity: 1 },
      { name: "Bala Ged Recovery", quantity: 1 },
      { name: "Barkchannel Pathway", quantity: 1 },
      { name: "Beast Whisperer", quantity: 1 },
      { name: "Beast Within", quantity: 1 },
      { name: "Blightstep Pathway", quantity: 1 },
      { name: "Bloodline Keeper", quantity: 1 },
      { name: "Branchloft Pathway", quantity: 1 },
      { name: "Brightclimb Pathway", quantity: 1 },
      { name: "Butcher of Malakir", quantity: 1 },
      { name: "Chandra, Fire of Kaladesh", quantity: 1 },
      { name: "Chromatic Lantern", quantity: 1 },
      { name: "Clearwater Pathway", quantity: 1 },
      { name: "Command Tower", quantity: 1 },
      { name: "Commander's Sphere", quantity: 1 },
      { name: "Cosima, God of the Voyage", quantity: 1 },
      { name: "Cragcrown Pathway", quantity: 1 },
      { name: "Darkbore Pathway", quantity: 1 },
      { name: "Dennick, Pious Apprentice", quantity: 1 },
      { name: "Diluvian Primordial", quantity: 1 },
      { name: "Dowsing Dagger", quantity: 1 },
      { name: "Elbrus, the Binding Blade", quantity: 1 },
      { name: "Emmara, Soul of the Accord", quantity: 1 },
      { name: "Evolving Wilds", quantity: 1 },
      { name: "Exotic Orchard", quantity: 1 },
      { name: "Farseek", quantity: 1 },
      { name: "Fellwar Stone", quantity: 1 },
      { name: "Forest", quantity: 3 },
      { name: "Frontier Bivouac", quantity: 1 },
      { name: "Garruk Relentless", quantity: 1 },
      { name: "Guardian Project", quantity: 1 },
      { name: "Hadana's Climb", quantity: 1 },
      { name: "Hagra Mauling", quantity: 1 },
      { name: "Harmonize", quantity: 1 },
      { name: "Hengegate Pathway", quantity: 1 },
      { name: "Island", quantity: 1 },
      { name: "Jace, Vryn's Prodigy", quantity: 1 },
      { name: "Jolrael, Mwonvuli Recluse", quantity: 1 },
      { name: "Journey to Eternity", quantity: 1 },
      { name: "Jungle Shrine", quantity: 1 },
      { name: "Kinnan, Bonder Prodigy", quantity: 1 },
      { name: "Kolvori, God of Kinship", quantity: 1 },
      { name: "Kytheon, Hero of Akros", quantity: 1 },
      { name: "Legion's Landing", quantity: 1 },
      { name: "Liliana, Heretical Healer", quantity: 1 },
      { name: "Ludevic, Necrogenius", quantity: 1 },
      { name: "Meteor Golem", quantity: 1 },
      { name: "Mila, Crafty Companion", quantity: 1 },
      { name: "Mountain", quantity: 1 },
      { name: "Needleverge Pathway", quantity: 1 },
      { name: "Nicol Bolas, the Ravager", quantity: 1 },
      { name: "Nissa, Vastwood Seer", quantity: 1 },
      { name: "Ondu Inversion", quantity: 1 },
      { name: "Opulent Palace", quantity: 1 },
      { name: "Path of Ancestry", quantity: 1 },
      { name: "Plains", quantity: 1 },
      { name: "Plargg, Dean of Chaos", quantity: 1 },
      { name: "Pongify", quantity: 1 },
      { name: "Putrefy", quantity: 1 },
      { name: "Rhys the Redeemed", quantity: 1 },
      { name: "Rimewood Falls", quantity: 1 },
      { name: "Riverglide Pathway", quantity: 1 },
      { name: "Sandsteppe Citadel", quantity: 1 },
      { name: "Sandstone Oracle", quantity: 1 },
      { name: "Savage Lands", quantity: 1 },
      { name: "Scattered Groves", quantity: 1 },
      { name: "Search for Azcanta", quantity: 1 },
      { name: "Seaside Citadel", quantity: 1 },
      { name: "Shaile, Dean of Radiance", quantity: 1 },
      { name: "Sheltered Thicket", quantity: 1 },
      { name: "Sisay, Weatherlight Captain", quantity: 1 },
      { name: "Sol Ring", quantity: 1 },
      { name: "Sphinx of the Second Sun", quantity: 1 },
      { name: "Swamp", quantity: 1 },
      { name: "Terramorphic Expanse", quantity: 1 },
      { name: "Thaumatic Compass", quantity: 1 },
      { name: "The World Tree", quantity: 1 },
      { name: "Time Wipe", quantity: 1 },
      { name: "Tireless Provisioner", quantity: 1 },
      { name: "Tovolar's Huntmaster", quantity: 1 },
      { name: "Treasure Map", quantity: 1 },
      { name: "Triplicate Titan", quantity: 1 },
      { name: "Urza's Ruinous Blast", quantity: 1 },
      { name: "Utter End", quantity: 1 },
      { name: "Valakut Awakening", quantity: 1 },
      { name: "Valentin, Dean of the Vein", quantity: 1 },
      { name: "Valki, God of Lies", quantity: 1 },
      { name: "Vivid Grove", quantity: 1 },
      { name: "Voldaren Pariah", quantity: 1 },
      { name: "Westvale Abbey", quantity: 1 },
      { name: "Woodland Chasm", quantity: 1 },
      { name: "Zetalpa, Primal Dawn", quantity: 1 },
    ],
    sideboard: [],
  },
  {
    id: "anikthea-hand-of-erebos",
    name: "Anikthea, Hand of Erebos",
    formatId: "commander",
    commanders: ["Anikthea, Hand of Erebos"],
    signatureSpell: null,
    credit: "Rob Porter",
    note: "",
    addedAt: "2026-09-17",
    main: [
      { name: "Abundance", quantity: 1 },
      { name: "Arasta of the Endless Web", quantity: 1 },
      { name: "Arcane Signet", quantity: 1 },
      { name: "Archon of Sun's Grace", quantity: 1 },
      { name: "Ash Barrens", quantity: 1 },
      { name: "Battle at the Helvault", quantity: 1 },
      { name: "Battle for Bretagard", quantity: 1 },
      { name: "Binding the Old Gods", quantity: 1 },
      { name: "Boon of the Spirit Realm", quantity: 1 },
      { name: "Cacophony Unleashed", quantity: 1 },
      { name: "Calix, Destiny's Hand", quantity: 1 },
      { name: "Canopy Vista", quantity: 1 },
      { name: "Cast Out", quantity: 1 },
      { name: "Command Tower", quantity: 1 },
      { name: "Composer of Spring", quantity: 1 },
      { name: "Courser of Kruphix", quantity: 1 },
      { name: "Culling Ritual", quantity: 1 },
      { name: "Cunning Rhetoric", quantity: 1 },
      { name: "Demon of Fate's Design", quantity: 1 },
      { name: "Destiny Spinner", quantity: 1 },
      { name: "Doomwake Giant", quantity: 1 },
      { name: "Dreadhorde Invasion", quantity: 1 },
      { name: "Dryad of the Ilysian Grove", quantity: 1 },
      { name: "Eidolon of Blossoms", quantity: 1 },
      { name: "Enchantress's Presence", quantity: 1 },
      { name: "Erebos, Bleak-Hearted", quantity: 1 },
      { name: "Exotic Orchard", quantity: 1 },
      { name: "Extinguish All Hope", quantity: 1 },
      { name: "Farseek", quantity: 1 },
      { name: "Felidar Retreat", quantity: 1 },
      { name: "Font of Fertility", quantity: 1 },
      { name: "Forest", quantity: 8 },
      { name: "Fortified Village", quantity: 1 },
      { name: "Ghoulish Impetus", quantity: 1 },
      { name: "Golgari Rot Farm", quantity: 1 },
      { name: "Grasp of Fate", quantity: 1 },
      { name: "Greater Tanuki", quantity: 1 },
      { name: "Heliod, God of the Sun", quantity: 1 },
      { name: "Herald of the Pantheon", quantity: 1 },
      { name: "Jukai Naturalist", quantity: 1 },
      { name: "Khalni Heart Expedition", quantity: 1 },
      { name: "Kodama's Reach", quantity: 1 },
      { name: "Krosan Verge", quantity: 1 },
      { name: "Love Song of Night and Day", quantity: 1 },
      { name: "Mesa Enchantress", quantity: 1 },
      { name: "Mindwrack Harpy", quantity: 1 },
      { name: "Mirari's Wake", quantity: 1 },
      { name: "Narci, Fable Singer", quantity: 1 },
      { name: "Necroblossom Snarl", quantity: 1 },
      { name: "Nessian Wanderer", quantity: 1 },
      { name: "Nyx Weaver", quantity: 1 },
      { name: "Nyxborn Behemoth", quantity: 1 },
      { name: "Omen of the Hunt", quantity: 1 },
      { name: "Omen of the Sun", quantity: 1 },
      { name: "Ondu Spiritdancer", quantity: 1 },
      { name: "Orzhov Basilica", quantity: 1 },
      { name: "Path to Exile", quantity: 1 },
      { name: "Plains", quantity: 6 },
      { name: "Rampant Growth", quantity: 1 },
      { name: "Sanctum Weaver", quantity: 1 },
      { name: "Sandsteppe Citadel", quantity: 1 },
      { name: "Sandwurm Convergence", quantity: 1 },
      { name: "Satyr Enchanter", quantity: 1 },
      { name: "Selesnya Sanctuary", quantity: 1 },
      { name: "Setessan Champion", quantity: 1 },
      { name: "Shineshadow Snarl", quantity: 1 },
      { name: "Sigil of the Empty Throne", quantity: 1 },
      { name: "Sol Ring", quantity: 1 },
      { name: "Spirited Companion", quantity: 1 },
      { name: "Starfield Mystic", quantity: 1 },
      { name: "Starfield of Nyx", quantity: 1 },
      { name: "Sungrass Prairie", quantity: 1 },
      { name: "Swamp", quantity: 5 },
      { name: "Sythis, Harvest's Hand", quantity: 1 },
      { name: "Tainted Field", quantity: 1 },
      { name: "Tainted Wood", quantity: 1 },
      { name: "Temple of Malady", quantity: 1 },
      { name: "Temple of Plenty", quantity: 1 },
      { name: "Temple of Silence", quantity: 1 },
      { name: "The Binding of the Titans", quantity: 1 },
      { name: "The Eldest Reborn", quantity: 1 },
      { name: "The Mending of Dominaria", quantity: 1 },
      { name: "Verduran Enchantress", quantity: 1 },
    ],
    sideboard: [],
  },
  {
    id: "commodore-guff",
    name: "Commodore Guff",
    formatId: "commander",
    commanders: ["Commodore Guff"],
    signatureSpell: null,
    credit: "Rob Porter",
    note: "",
    addedAt: "2026-09-17",
    main: [
      { name: "Ajani Steadfast", quantity: 1 },
      { name: "Arcane Signet", quantity: 1 },
      { name: "Azorius Signet", quantity: 1 },
      { name: "Blasphemous Act", quantity: 1 },
      { name: "Boros Signet", quantity: 1 },
      { name: "Cartographer's Hawk", quantity: 1 },
      { name: "Cascade Bluffs", quantity: 1 },
      { name: "Chandra, Awakened Inferno", quantity: 1 },
      { name: "Chandra, Legacy of Fire", quantity: 1 },
      { name: "Chandra, Torch of Defiance", quantity: 1 },
      { name: "Command Tower", quantity: 1 },
      { name: "Deepglow Skate", quantity: 1 },
      { name: "Deploy the Gatewatch", quantity: 1 },
      { name: "Elspeth, Sun's Champion", quantity: 1 },
      { name: "Exotic Orchard", quantity: 1 },
      { name: "Fellwar Stone", quantity: 1 },
      { name: "Flux Channeler", quantity: 1 },
      { name: "Fog Bank", quantity: 1 },
      { name: "Forge of Heroes", quantity: 1 },
      { name: "Frostboil Snarl", quantity: 1 },
      { name: "Furycalm Snarl", quantity: 1 },
      { name: "Gatewatch Beacon", quantity: 1 },
      { name: "Gideon Jura", quantity: 1 },
      { name: "Grateful Apparition", quantity: 1 },
      { name: "Guff Rewrites History", quantity: 1 },
      { name: "Honor-Worn Shaku", quantity: 1 },
      { name: "Interplanar Beacon", quantity: 1 },
      { name: "Island", quantity: 7 },
      { name: "Izzet Signet", quantity: 1 },
      { name: "Jace Beleren", quantity: 1 },
      { name: "Jace, Architect of Thought", quantity: 1 },
      { name: "Jace, Mirror Mage", quantity: 1 },
      { name: "Jaya's Phoenix", quantity: 1 },
      { name: "Karn's Bastion", quantity: 1 },
      { name: "Kazuul, Tyrant of the Cliffs", quantity: 1 },
      { name: "Leori, Sparktouched Hunter", quantity: 1 },
      { name: "Mangara, the Diplomat", quantity: 1 },
      { name: "Mobilized District", quantity: 1 },
      { name: "Mountain", quantity: 4 },
      { name: "Myriad Landscape", quantity: 1 },
      { name: "Mystic Gate", quantity: 1 },
      { name: "Mystic Monastery", quantity: 1 },
      { name: "Nahiri, the Harbinger", quantity: 1 },
      { name: "Narset of the Ancient Way", quantity: 1 },
      { name: "Narset, Enlightened Master", quantity: 1 },
      { name: "Narset, Parter of Veils", quantity: 1 },
      { name: "Nevinyrral's Disk", quantity: 1 },
      { name: "Norn's Annex", quantity: 1 },
      { name: "Oath of Gideon", quantity: 1 },
      { name: "Oath of Jace", quantity: 1 },
      { name: "Oath of Teferi", quantity: 1 },
      { name: "Onakke Oathkeeper", quantity: 1 },
      { name: "Oreskos Explorer", quantity: 1 },
      { name: "Path to Exile", quantity: 1 },
      { name: "Plains", quantity: 7 },
      { name: "Port Town", quantity: 1 },
      { name: "Prairie Stream", quantity: 1 },
      { name: "Promise of Loyalty", quantity: 1 },
      { name: "Reliquary Tower", quantity: 1 },
      { name: "Repeated Reverberation", quantity: 1 },
      { name: "Rugged Prairie", quantity: 1 },
      { name: "Saheeli, Sublime Artificer", quantity: 1 },
      { name: "Sarkhan the Masterless", quantity: 1 },
      { name: "Semester's End", quantity: 1 },
      { name: "Silent Arbiter", quantity: 1 },
      { name: "Skycloud Expanse", quantity: 1 },
      { name: "Sol Ring", quantity: 1 },
      { name: "Spark Double", quantity: 1 },
      { name: "Sparkshaper Visionary", quantity: 1 },
      { name: "Swords to Plowshares", quantity: 1 },
      { name: "Talisman of Conviction", quantity: 1 },
      { name: "Talisman of Creativity", quantity: 1 },
      { name: "Talisman of Progress", quantity: 1 },
      { name: "Temple of Enlightenment", quantity: 1 },
      { name: "Temple of Epiphany", quantity: 1 },
      { name: "Temple of Triumph", quantity: 1 },
      { name: "Teyo, Geometric Tactician", quantity: 1 },
      { name: "The Chain Veil", quantity: 1 },
      { name: "The Wanderer", quantity: 1 },
      { name: "Thrummingbird", quantity: 1 },
      { name: "Urza's Ruinous Blast", quantity: 1 },
      { name: "Vronos, Masked Inquisitor", quantity: 1 },
      { name: "Wall of Denial", quantity: 1 },
      { name: "Wayfarer's Bauble", quantity: 1 },
    ],
    sideboard: [],
  },
]

/**
 * A double-faced commander is "Esika, God of the Tree // The Prismatic Bridge"
 * to Scryfall and "Esika, God of the Tree" on every decklist ever written. Match
 * on the front face as well as the whole name, or every MDFC commander silently
 * has no examples — a failure that looks exactly like having none.
 */
function commanderKeys(name) {
  const full = String(name ?? '').toLowerCase().trim()
  const front = full.split('//')[0].trim()
  return front && front !== full ? [full, front] : [full]
}

/**
 * Names in an example that resolve to nothing.
 *
 * A supplied decklist can carry a name that is not a card — a spoiler-era
 * spelling, a hand-typed line, something that never shipped. Deleting it loses
 * information and pretending it resolves is worse, so it stays in the list and
 * declares itself. The importer already shows unresolved lines with
 * alternatives, so the reader sees the truth either way.
 */
export function unverifiedIn(example) {
  return example?.unverified ?? []
}

export function exampleDecksFor(commanderName) {
  if (!commanderName) return []
  const wanted = new Set(commanderKeys(commanderName))
  return EXAMPLE_DECKS.filter((deck) =>
    deck.commanders.some((name) => commanderKeys(name).some((key) => wanted.has(key))))
}

/**
 * Turns a deck plus its resolved cards into a shippable entry.
 *
 * Emits names rather than ids, and sorts the list so a re-export of an
 * unchanged deck produces an identical file — otherwise every export looks
 * like a change.
 */
export function toExampleEntry(deck, lookup, { credit = '', note = '' } = {}) {
  const nameOf = (id) => lookup(id)?.name ?? null
  const entry = (list) => list
    .map(({ cardId, quantity }) => ({ name: nameOf(cardId), quantity }))
    .filter((c) => c.name)
    .sort((a, b) => a.name.localeCompare(b.name))

  return {
    id: deck.id,
    name: deck.name,
    formatId: deck.formatId,
    commanders: deck.commanders.map(nameOf).filter(Boolean),
    signatureSpell: deck.signatureSpell ? nameOf(deck.signatureSpell) : null,
    main: entry(deck.main),
    sideboard: entry(deck.sideboard),
    credit,
    note,
    addedAt: new Date().toISOString().slice(0, 10),
  }
}

/** The plain text an example entry would import as. */
export function exampleToDecklist(example) {
  const lines = []
  if (example.commanders?.length) {
    lines.push('Commander')
    for (const name of example.commanders) lines.push(`1 ${name}`)
    if (example.signatureSpell) lines.push(`1 ${example.signatureSpell}`)
    lines.push('')
  }
  lines.push('Deck')
  for (const { name, quantity } of example.main ?? []) lines.push(`${quantity} ${name}`)
  if (example.sideboard?.length) {
    lines.push('', 'Sideboard')
    for (const { name, quantity } of example.sideboard) lines.push(`${quantity} ${name}`)
  }
  return lines.join('\n')
}

/** Total card count, for showing a list is complete before opening it. */
export function exampleSize(example) {
  const main = (example.main ?? []).reduce((n, c) => n + c.quantity, 0)
  return main + (example.commanders?.length ?? 0) + (example.signatureSpell ? 1 : 0)
}
