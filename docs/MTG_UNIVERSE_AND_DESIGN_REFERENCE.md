# Magic: The Gathering — Universe & Design Reference for Claude Code

> **Purpose:** Working context for software, interface, content, and visual-design tasks inspired by *Magic: The Gathering* (MTG).
> **Audience:** Claude Code or another implementation agent.
> **Freshness:** 2026-09-17.
> **Canon posture:** Treat official Wizards of the Coast sources as authoritative. Treat this guide as a compact operating model, not a replacement for current rules, card databases, or story text.

## 0. Instructions to the implementing agent

When this file is present:

1. Preserve MTG's central idea: innumerable distinct worlds connected by dangerous or exceptional travel, all interpreted through five philosophies of magic.
2. Separate **lore**, **game rules**, **card presentation**, and **product marketing**. They influence one another but are not interchangeable.
3. Use the five-color system semantically, not as decoration. A color should imply a worldview and behavior.
4. Never invent current legality, card text, release dates, or post-2026 canon. Query an authoritative live source when those details matter.
5. Do not reproduce proprietary logos, mana glyphs, card frames, card art, or commercial typefaces unless the project contains properly licensed assets and explicitly calls for them.
6. For an original or unofficial project, evoke the design grammar—layered fantasy materials, illustrated portals, restrained metallic accents, color-as-philosophy—without counterfeiting a Magic card or implying Wizards endorsement.
7. When a request concerns the 2026 set **Reality Fracture**, load `REALITY_FRACTURE_SET_REFERENCE.md` as the more specific authority.

---

## 1. The shortest accurate mental model

*Magic: The Gathering* is a fantasy multiverse told through a strategy card game. Players are represented as powerful spellcasters. They draw mana from lands, cast spells, summon creatures, call on artifacts and enchantments, and sometimes invoke planeswalkers. The fiction spans many self-contained planes—each with its own genres, peoples, physics, and conflicts—while recurring characters and crises connect those worlds.

The franchise has four simultaneous identities:

| Layer | What it is | Implementation consequence |
|---|---|---|
| Game | A resource-driven, highly interactive trading card game | Information hierarchy and exact wording matter; mechanics must remain distinct from flavor |
| Multiverse | A collection of planes separated by the Blind Eternities | A feature can move between genres while still feeling like one franchise |
| Color pie | Five competing philosophies and mechanical identities | Color is semantic, behavioral, narrative, and visual |
| Collectible object | Illustrated cards with rarity, variants, frames, foils, and set identities | Tactility, curation, reveal, and collection are part of the experience |

The emotional core is **possibility under constraint**: a huge imaginative universe made legible through strict rules, resource costs, color identity, and card-sized artifacts.

---

## 2. Cosmology and metaphysics

### 2.1 Plane

A plane is a world or reality with its own geography, cultures, species, history, magical expression, and visual identity. A plane can support one genre strongly—Gothic horror, heroic mythology, urban intrigue, fairy-tale duality, magical academia, frontier fantasy, or space opera—without redefining the entire franchise.

Do not flatten planes into biomes. Ravnica is not merely “the city plane”; it is an ecumenopolis shaped by ten guilds, civic institutions, class, law, and ancient pacts. Innistrad is not merely “the horror plane”; it is human endurance, faith, monstrosity, and cyclical dread.

### 2.2 The Multiverse

The Multiverse is the totality of planes. The same person, species, spell concept, or historical pattern may recur in different ways, but ordinary continuity should not assume easy contact between every world.

### 2.3 The Blind Eternities

The Blind Eternities are the chaotic, hostile medium between planes. Historically, natural interplanar travel was largely limited to planeswalkers and exceptional entities or technologies. This makes crossing worlds narratively significant rather than routine transportation.

### 2.4 Planeswalkers and sparks

A planeswalker is a being whose latent “spark” has ignited, historically allowing interplanar travel. Spark ignition is commonly associated with extreme crisis or transformation. Planeswalkers are powerful but, in the modern era, are not omnipotent gods.

Following the Phyrexian invasion and the Great Pruning, many planeswalkers lost their sparks. Do not assume that any historically known planeswalker still has one. Verify current status when it affects a story or feature.

### 2.5 Omenpaths

Omenpaths are routes connecting planes that became widespread after the New Phyrexian invasion. They allow non-planeswalkers to cross between worlds, changing trade, migration, diplomacy, and conflict. They are story infrastructure, not necessarily safe, stable, or universally mapped roads.

### 2.6 Mana and leylines

Mana is magical energy, classically drawn through a bond with lands. Basic land types map to the five colors:

| Land | Mana | Broad association |
|---|---|---|
| Plains | White | Community, order, protection, law, light |
| Island | Blue | Knowledge, possibility, artifice, water, air, mind |
| Swamp | Black | Ambition, mortality, sacrifice, decay, self-interest |
| Mountain | Red | Emotion, freedom, impulse, fire, earth, destruction |
| Forest | Green | Nature, growth, instinct, interdependence, destiny |

Colorless mana is not a sixth philosophy. It often represents artifacts, the Eldrazi, unusual environments, or power outside normal colored expression. Generic costs can be paid with mana of any color or colorless mana; a true colorless-mana symbol specifically requires colorless mana.

### 2.7 Death, souls, gods, and magic

These are plane-dependent. MTG does not have one universal theology or one identical afterlife. Gods may be manifestations of belief, embodiments of natural forces, immensely powerful beings, or plane-specific divine systems. Necromancy, spirits, resurrection, and soul magic behave differently across settings. Preserve local metaphysics.

---

## 3. Narrative eras and continuity

Use this as orientation, not as an exhaustive chronology.

| Era | Approximate focus | Design/lore significance |
|---|---|---|
| Early Dominaria / Urza saga | Brothers' War, Thran legacy, Phyrexia, Weatherlight | Mythic foundational history; artifacts, legacy weapons, apocalyptic wars |
| Post-Invasion and temporal crises | Mirrodin, Kamigawa, Ravnica, Time Spiral | Planes become more distinct; the Mending reduces planeswalker power |
| Gatewatch era | Jace, Chandra, Liliana, Gideon, Nissa; Bolas arc | Superhero-like recurring ensemble; plane-hopping serial narrative |
| War of the Spark | Nicol Bolas invades Ravnica | Major convergence and culmination of the Gatewatch/Bolas story |
| New Phyrexian arc | Kaldheim through March of the Machine | Multiversal invasion; compleation; Realmbreaker; massive continuity change |
| Omenpath era | Aftermath onward | Non-planeswalker travel, cross-planar encounters, desparked characters |
| Metronome / Reality Fracture climax | Jace's project and the Echoverse | Alternate-reality logic, identity, imposed utopia, mirrored histories |

### Continuity rule

For current-state work, a character's old iconic status is not enough. Verify:

- alive/dead/unknown;
- sparked/desparked;
- current plane;
- affiliations;
- whether an appearance is main Multiverse, alternate reality, past, dream, copy, token, or non-canon promotional treatment.

---

## 4. Representative planes and their visual/narrative grammar

This selection is deliberately broad rather than exhaustive.

| Plane | Core identity | Visual vocabulary | Common mistake to avoid |
|---|---|---|---|
| Dominaria | Ancient, history-dense nexus world | Layered ruins, nations, relics from many eras | Treating it as generic medieval fantasy |
| Ravnica | World-city governed by ten guilds | Dense vertical city, civic heraldry, Eastern/Central European influence | Reducing guilds to Hogwarts houses |
| Innistrad | Gothic horror and human survival | Moonlight, timber villages, cathedrals, graveyards, visceral monsters | Making horror stylish but emotionally consequence-free |
| Zendikar | Adventure world with volatile land and ancient Eldrazi scars | Floating hedrons, impossible landscapes, expedition gear | Ignoring that the land itself is active and dangerous |
| Mirrodin / New Phyrexia | Artificial metal plane transformed by invasive perfection | Living metal, biomechanical orthodoxy, factional horror | Using generic robots; Phyrexia is bodily and ideological assimilation |
| Theros | Mythic world shaped by belief | Constellation “Nyx,” marble, bronze, heroic silhouettes | Copying Greece literally without the belief-made-real metaphysics |
| Tarkir | Dragon-dominated plane with clan histories | Steppe, monasteries, storms, draconic forms, clan textiles | Treating clans as interchangeable color wedges only |
| Kaladesh | Optimistic invention complicated by authority | Filigree, luminous aether, elegant mechanisms, festival color | Defaulting to dirty industrial steampunk |
| Amonkhet | Nicol Bolas's engineered trial-world | Monumental desert civilization, ritual, sun, undead labor | Using Egypt as surface ornament without the imposed social system |
| Ixalan | Exploration, empire, dinosaurs, vampires, pirates; deep-world cultures | Mesoamerican influence, jungle, gold, sails, subterranean sun | Collapsing the plane into “pirates versus dinosaurs” |
| Eldraine | Arthurian court and dangerous fairy tale | Storybook forest, heraldry, feasts, witches, enchanted objects | Making it harmless children’s fantasy |
| Kaldheim | Ten realms linked by the World Tree | Norse-inspired carving, runes, ice, longships, cosmic roots | Treating it as only Vikings and snow |
| Kamigawa | Tradition and futurity in tension | Kami, shrines, neon, cybernetic craft, Japanese visual roots | Separating “old” and “new” so completely that their coexistence vanishes |
| Arcavios / Strixhaven | Magical university and scholarly conflict | Five colleges, spell diagrams, libraries, campus life | Treating the colleges as only personalities rather than academic philosophies |
| New Capenna | Demon-founded art-deco metropolis | 1920s glamour, halo, five crime families, vertical city | Ordinary real-world gangster pastiche with no magical ecology |
| Thunder Junction | Omenpath frontier convergence | Desert frontier, rail, vaults, imported identities | Assuming its genre imagery describes ancient local history |
| Duskmourn | Plane consumed by an endless horror house | 1970s–80s material culture, impossible interiors, survival horror | Using a normal haunted mansion with exterior geography |
| Bloomburrow | Animalfolk-scale pastoral heroism | Tiny tools, seasonal nature, calamity beasts | Treating small scale as low stakes |
| Sothera / Edge of Eternities | Space-fantasy system beyond conventional planes | Retro-futurist spacecraft, planets, void phenomena | Turning MTG into clean hard science fiction |

### Plane design test

A convincing plane can answer all of the following:

1. What makes daily life different here?
2. What does each color want here?
3. Where does mana visibly enter the culture?
4. What contradiction drives the setting?
5. Which silhouettes, materials, and lighting are uniquely recognizable?
6. What can happen here that could not happen on another plane?

---

## 5. The color pie: philosophy, behavior, and visual direction

The five colors are not moral alignments. Every color can be heroic, villainous, communal, selfish, compassionate, or cruel. Each color prioritizes different ends and methods.

### 5.1 White — peace through structure

- **Wants:** peace, safety, fairness, civilization, collective flourishing.
- **Believes:** rules, institutions, duty, and shared sacrifice can protect the many.
- **Strengths:** protection, coordination, law, healing, equality, armies, exile.
- **Failure mode:** authoritarianism, dogma, enforced conformity, moral certainty.
- **Visual cues:** sunlit ivory, gold, disciplined spacing, symmetry, shields, circles, banners.
- **UI behavior:** clear hierarchy, predictable grids, reassurance, protective affordances.

### 5.2 Blue — perfection through knowledge

- **Wants:** understanding, improvement, possibility, mastery.
- **Believes:** people and systems can be refined through learning, planning, and technology.
- **Strengths:** foresight, card selection, counterspells, illusion, transformation, control.
- **Failure mode:** paralysis, manipulation, emotional detachment, treating lives as variables.
- **Visual cues:** deep blue, cyan light, water/air motion, diagrams, lenses, runes, fine geometry.
- **UI behavior:** information density, filters, previews, deliberate interaction, states within states.

### 5.3 Black — power through opportunity

- **Wants:** agency, ambition, self-determination, survival, power.
- **Believes:** every resource has a price and taboos should not prevent success.
- **Strengths:** sacrifice, graveyard use, removal, life as a resource, bargains, recursion.
- **Failure mode:** exploitation, nihilism, predation, willingness to externalize every cost.
- **Visual cues:** near-black, violet, sickly gold, bone, smoke, sharp luxury, decay.
- **UI behavior:** high contrast, explicit costs, risk/reward, irreversible-feeling decisions.

### 5.4 Red — freedom through action

- **Wants:** freedom, authentic emotion, immediacy, connection, self-expression.
- **Believes:** life must be lived, not overplanned; instinct can reveal truth.
- **Strengths:** speed, direct damage, impulse, temporary advantage, chaos, passionate creation.
- **Failure mode:** recklessness, rage, shortsighted destruction, refusal of responsibility.
- **Visual cues:** scarlet, ember orange, heat distortion, diagonals, torn edges, kinetic marks.
- **UI behavior:** quick actions, bold feedback, urgency, motion, low-friction commitment.

### 5.5 Green — harmony through acceptance

- **Wants:** growth, belonging, continuity, natural balance, fulfilled potential.
- **Believes:** the world has an underlying order; wisdom comes from accepting one's place within it.
- **Strengths:** creatures, mana growth, resilience, natural destruction, instinct, scale.
- **Failure mode:** fatalism, anti-intellectualism, brutal “natural order,” resistance to necessary change.
- **Visual cues:** forest green, moss, amber sunlight, roots, branching forms, organic mass.
- **UI behavior:** progressive growth, connected systems, spaciousness, grounded transitions.

### 5.6 Relationships

The canonical wheel order is **White → Blue → Black → Red → Green → White**.

- Adjacent colors are traditional allies: WU, UB, BR, RG, GW.
- Nonadjacent colors are traditional enemies: WB, UR, BG, RW, GU.
- Alliance does not mean agreement; it means more shared assumptions.
- Enemy pairs are especially productive because they pursue a synthesis across a philosophical conflict.

### 5.7 Two-color shorthand

Guild names are Ravnican institutions, not universal names for color pairs, though players use them as shorthand.

| Pair | Player shorthand | Philosophical synthesis |
|---|---|---|
| WU | Azorius | ordered improvement; systems, law, planning |
| UB | Dimir | knowledge as leverage; secrecy, control, ambition |
| BR | Rakdos | expressive self-interest; appetite, spectacle, destruction |
| RG | Gruul | instinctive freedom; embodied action, wild strength |
| GW | Selesnya | communal nature; belonging, growth, collective order |
| WB | Orzhov | structured ambition; hierarchy, debt, duty and power |
| UR | Izzet | experimental expression; invention, curiosity, volatility |
| BG | Golgari | life through death; cycles, pragmatism, resilience |
| RW | Boros | passionate justice; action in service of order |
| GU | Simic | directed evolution; nature improved through knowledge |

### 5.8 Three colors and five colors

- **Shards** center one color with its two allies: Bant (GWU), Esper (WUB), Grixis (UBR), Jund (BRG), Naya (RGW).
- **Wedges** center one color with its two enemies: Abzan (WBG), Jeskai (URW), Sultai (BGU), Mardu (RWB), Temur (GUR).
- These proper names belong to particular settings, though players use them as shorthand.
- Five-color expression suggests totality, synthesis, abundance, or difficult unity. It should feel intentional, not merely rainbow decoration.

### 5.9 Neutral implementation palette

These are **recommended digital tokens**, not official Wizards brand specifications. They are tuned for accessible UI accents, not exact card-frame reproduction.

| Token | Hex | Use |
|---|---:|---|
| `--mana-white` | `#F2E6B6` | White identity accent on dark UI |
| `--mana-blue` | `#3B82B8` | Blue identity accent |
| `--mana-black` | `#5B5263` | Black identity accent; use with light text |
| `--mana-red` | `#C64A36` | Red identity accent |
| `--mana-green` | `#3F7D55` | Green identity accent |
| `--mana-colorless` | `#9AA3A8` | Colorless/artifact accent |
| `--mana-gold` | `#B89446` | Multicolor and premium accent |

Never communicate color identity by color alone. Pair color with a label, pattern, icon, or position.

---

## 6. Magic as a game system

### 6.1 Fundamental metaphor

- A deck is a **library**.
- Drawn cards form a **hand**.
- Spells and abilities wait on the **stack** and resolve last-in, first-out.
- Permanents occupy the **battlefield**.
- Used, destroyed, or discarded cards often go to the **graveyard**.
- **Exile** is a distinct zone, not a second graveyard.
- Lands usually generate mana by being **tapped**, represented physically by turning them sideways.

### 6.2 Core card types

| Type | Role |
|---|---|
| Land | Primary mana infrastructure; played rather than cast |
| Creature | Persistent combatant with power and toughness |
| Instant | One-shot spell cast at broad timing windows |
| Sorcery | One-shot spell normally cast during the caster's main phase |
| Artifact | Persistent object, often colorless but not necessarily |
| Enchantment | Persistent magical condition or structure |
| Planeswalker | Persistent ally represented by loyalty abilities |
| Battle | A defended objective/permanent with specialized rules |
| Kindred | Card type that allows noncreature cards to carry creature types; verify current templating |

Supertypes such as **legendary**, **basic**, and **snow** modify card identity. Subtypes such as Human, Wizard, Equipment, Aura, and Forest carry rules meaning.

### 6.3 UX lessons from Magic

Magic communicates complex state through stable zones, templated verbs, visible costs, and consistent sequencing. For software inspired by it:

- Put costs before commitment.
- Make zones visually and spatially distinct.
- Show what can respond before resolution.
- Use concise, repeated verbs instead of stylistic synonyms.
- Treat hidden information, revealed information, and public history as different states.
- Make rarity and collectibility secondary to comprehension during play.

### 6.4 Rules precision

Card rules text is executable language. Flavorful paraphrase is not equivalent. If reproducing or analyzing exact rules, use the current Oracle text from Gatherer or another authorized/credible card database and note the retrieval date.

---

## 7. Characters and factions: orientation map

This is a recognition layer, not a current-status database.

### Recurring figures

| Figure | Core association | Caution |
|---|---|---|
| Jace Beleren | Blue mind mage; memory, illusion, responsibility, control | His identity, memory, morality, and current state change substantially across arcs |
| Chandra Nalaar | Red pyromancer; passion, rebellion, loyalty | More than impulsive fire; relationships and responsibility matter |
| Liliana Vess | Black necromancer; ambition, contracts, survival, guilt | Antiheroic growth does not erase ruthless methods |
| Ajani Goldmane | White-centered leonin; healing, community, mentorship | Has multicolor expressions and Phyrexian trauma |
| Garruk Wildspeaker | Green hunter; beasts, wilderness, curse and recovery | Not merely a barbarian; his relationship to nature and predation is central |
| Nissa Revane | Green animist; leylines, worldsouls, growth | Verify spark and current relationships |
| Teferi Akosa | Blue/white chronomancer; Zhalfir, responsibility, time | Carries consequences of past choices and long historical scope |
| Karn | Colorless silver golem; artifacts, legacy, creation, Phyrexia | Both creator and victim within Phyrexian history |
| Elspeth Tirel | White hero; survival, devotion, angelic transformation | Deeply tied to Phyrexian trauma and Theros |
| Nicol Bolas | Elder Dragon; blue/black/red domination and schemes | Defeated/contained status must not be casually undone |
| Ugin | Spirit Dragon; colorless magic, balance, long strategy | Bolas's twin but not a simple moral inverse |
| Vraska | Black/green gorgon; justice, assassination, Golgari, Jace | Current status and loyalties are arc-sensitive |

### Major factions/concepts

- **Gatewatch:** a changing coalition originally sworn to defend the Multiverse; never assume a fixed roster.
- **Phyrexia:** an ideology and civilization of forced perfection through biomechanical assimilation. Five praetors expressed five colored versions of Phyrexian perfection.
- **Eldrazi:** incomprehensible titans and lineages associated with the Blind Eternities and consumption/transformation of planes. Avoid reducing them to ordinary giant monsters.
- **Ravnican guilds:** ten civic institutions based on all two-color pairs; each is politically and culturally specific.
- **Strixhaven colleges:** five enemy-color academic traditions on Arcavios; distinct from Ravnica's guilds even where colors overlap.

---

## 8. Visual identity system

### 8.1 Brand-level mood

Base Magic should feel:

- illustrated rather than sterile;
- ancient and tactile, even when technologically advanced;
- strategically precise beneath expressive fantasy;
- premium but not minimalist luxury;
- capable of supporting radically different genres while retaining consistent information architecture.

### 8.2 Materials

Useful materials include vellum, ink, carved wood, patinated bronze, dark iron, worn leather, stone, enamel, stained glass, luminous aether, etched geometry, and painterly atmospheric light. Select materials from the active plane; do not combine all of them at once.

### 8.3 Shape language

- Frames and panels: nested borders, bevels, restrained ornament, strong corner treatment.
- Portals and mana: circles, arcs, fivefold arrangements, radiating marks.
- Card/collection UI: portrait rectangles, layered stacks, subtle depth, precise alignment.
- Avoid generic “fantasy UI” clutter: random Celtic knots, excessive gold filigree, fake runes, and every surface textured.

### 8.4 Art direction

Magic art typically communicates a card concept at a glance. Favor:

1. one unmistakable subject or action;
2. a silhouette readable at card size;
3. environmental cues that identify the plane;
4. lighting that reinforces color identity without monochrome washing;
5. painterly specificity over generic photorealistic fantasy.

### 8.5 Motion

- Base duration: 160–240 ms for ordinary UI.
- Use 300–500 ms for a reveal, transform, planeswalk, or rarity moment.
- Favor physical metaphors: cards lift, tilt, tap, stack, slide, fan, or turn over.
- Reserve particles, chromatic separation, and lens distortion for magical events.
- Respect reduced-motion settings; replace spatial warps with opacity and border-state changes.

---

## 9. Typography

### 9.1 Known Magic typography

| Context | Typeface/history | Guidance |
|---|---|---|
| Modern card names and type lines | **Beleren**, a nine-font custom family commissioned by Wizards and designed by Delve Fonts | Proprietary/custom. Use only if a licensed project supplies the font files and usage rights |
| Rules text and flavor text | A **Plantin-style** serif, commonly identified in production/custom-card communities as MPlantin and an italic companion | Treat exact files as protected assets; do not source from unofficial downloads |
| Eighth Edition through Magic 2014 titles | **Matrix Bold** | Historical, not the current default card-title identity |
| Early card titles | Modified **Goudy Medieval**-style lettering | Historical; use only for intentionally retro treatment |
| Magic wordmark | Custom trademark artwork, not merely typed text | Use an authorized logo asset; do not recreate from a font |

### 9.2 Safe implementation stacks

For an unofficial web/app project, use open or system fonts that capture roles without impersonation:

```css
:root {
  --font-display: "Cinzel", "Cormorant SC", Georgia, serif;
  --font-heading: "Source Serif 4", "Noto Serif", Georgia, serif;
  --font-body: "Source Sans 3", Inter, system-ui, sans-serif;
  --font-rules: "Source Serif 4", Charter, Georgia, serif;
  --font-data: "IBM Plex Mono", ui-monospace, monospace;
}
```

Recommended roles:

- **Display/hero:** restrained engraved serif; uppercase or small caps; modest tracking.
- **Section headings:** literary serif with strong weight contrast.
- **Body/UI:** neutral humanist sans for accessibility.
- **Card-like rules excerpts:** readable serif, short line length, generous leading.
- **Collector/set codes:** compact sans or mono, uppercase.

Do not set long body copy in the decorative display face. Do not use tiny all-caps text for functional controls.

### 9.3 Type scale

```css
:root {
  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-md: 1rem;
  --text-lg: 1.25rem;
  --text-xl: 1.563rem;
  --text-2xl: 1.953rem;
  --text-3xl: 2.441rem;
  --text-4xl: clamp(3rem, 7vw, 5.96rem);
}
```

Keep lore/body measure near 60–75 characters. Card-grid labels may be shorter and denser.

---

## 10. Base product design tokens

These are original implementation recommendations, not official brand values.

```css
:root {
  color-scheme: dark;

  --ink-950: #0B0C0E;
  --ink-900: #121418;
  --ink-800: #1B1F24;
  --slate-650: #3E4852;
  --mist-300: #B8C0C7;
  --parchment-100: #EFE7D5;
  --parchment-50: #F8F3E8;
  --gold-500: #B89446;
  --gold-300: #D8C17A;

  --mana-white: #F2E6B6;
  --mana-blue: #3B82B8;
  --mana-black: #5B5263;
  --mana-red: #C64A36;
  --mana-green: #3F7D55;
  --mana-colorless: #9AA3A8;

  --surface-base: var(--ink-950);
  --surface-raised: var(--ink-900);
  --surface-card: var(--ink-800);
  --text-primary: var(--parchment-50);
  --text-secondary: var(--mist-300);
  --border-subtle: rgba(239, 231, 213, 0.16);
  --focus-ring: #8CC8FF;

  --radius-sm: 0.375rem;
  --radius-md: 0.75rem;
  --radius-lg: 1.25rem;
  --shadow-card: 0 12px 32px rgba(0, 0, 0, 0.38);

  /* The playmat: the table's battlefield is parchment inside the dark shell,
     after the tabletop studied in docs/table-rebuild/TARGET.md §7. */
  --mat: #CDB88C;
  --mat-light: #E4D5B0;
  --mat-shade: #8A7350;
  --mat-ink: #4A3A1E;
  --mat-rule: rgba(74, 58, 30, 0.24);
}
```

### Theme application

- The base shell should be neutral charcoal/parchment.
- Apply mana colors to badges, active states, charts, and localized glows—not every background.
- Gold indicates multicolor, rarity, ceremony, or premium status; overuse destroys meaning.
- Parchment works for lore/reading modes; dark surfaces work for collection and play modes.

---

## 11. Component patterns

### Card tile

- 5:7-ish portrait silhouette, but do not duplicate an official card frame.
- Art region dominates.
- Name and type remain readable before metadata.
- Color identity receives both color and text/icon encoding.
- Hover may lift 4–8 px and reveal metadata; do not rotate so far that art becomes hard to inspect.

### Plane card

- Hero image or abstract texture.
- Plane name, one-sentence contradiction, genre tags, current access state.
- One dominant local palette plus one mana accent.

### Color identity selector

- Preserve wheel order W-U-B-R-G.
- Show philosophical label on focus/selection.
- Multiselect should display combined meaning, not only overlapping colored circles.

### Timeline

- Divide by narrative era rather than every expansion.
- Allow uncertainty and retcons to be annotated.
- Identify alternate histories and flashbacks explicitly.

### Lore entity page

Recommended order: identity → current verified status → motivations → affiliations → key appearances → variants/alternate versions → sources.

---

## 12. Voice and naming

### Voice

Use confident, evocative, economical prose. Magic copy often gives one sharp image or contradiction and trusts the art to carry the rest.

Good:

- “Every cure takes root.”
- “A city of laws built over ten thousand private wars.”
- “The path opened. It did not ask what followed.”

Avoid:

- generic fantasy filler (“ancient mystical energies awaken”);
- lore-dump paragraphs in UI;
- comedy unless the plane, character, or card concept supports it;
- treating every event as the greatest threat ever faced.

### Naming tendencies

- Plane names are distinctive, pronounceable, and rarely ordinary English phrases.
- Organizations often have a functional or ideological root.
- Spell names favor strong noun/verb images and can read as miniature story beats.
- Legendary character epithets reveal state or role: “X, [transformative title].”

Do not generate names by merely adding apostrophes, “ae,” or random consonant clusters.

---

## 13. Accessibility and responsive behavior

- WCAG AA contrast is the minimum for functional text.
- Decorative parchment texture must not reduce text contrast.
- Mana-color charts need labels/patterns.
- Do not rely on foil shimmer or animation to convey rarity or selection.
- Keyboard focus must be visible against every color theme.
- On mobile, favor one-column reading, horizontally scrollable card rails, and bottom-sheet filters.
- A card preview should be dismissible, zoomable, and not trap keyboard or screen-reader users.
- Offer reduced motion and reduced transparency modes.

---

## 14. IP, trademark, and asset boundary

This guide describes a copyrighted fictional universe and visual system. It does not grant rights.

For unofficial or original work:

- Clearly label fan-made work when appropriate.
- Do not imply affiliation, sponsorship, or official status.
- Do not redraw the Magic wordmark, Planeswalker symbol, mana glyphs, set symbols, or trade dress as if official.
- Do not download proprietary fonts from unofficial repositories.
- Use original frames, icons, illustrations, and names for commercial work unless rights are secured.
- Link to official card images instead of repackaging them when a legitimate API/license permits it, and follow that source's terms.

---

## 15. Source-of-truth hierarchy

Use this order when sources disagree:

1. Current Magic Comprehensive Rules and official card rulings.
2. Current Oracle text in Gatherer.
3. Official Wizards product, story, mechanics, and announcement pages.
4. Wizards Play Network product documentation.
5. Official videos/panels/podcasts.
6. Reputable databases such as Scryfall for discovery and structured card data.
7. Community wikis for orientation only; verify consequential claims.

### Primary references

- [Official Magic site](https://magic.wizards.com/en)
- [How to Play Magic](https://magic.wizards.com/en/how-to-play)
- [Magic product archive](https://magic.wizards.com/en/products/card-set-archive)
- [Gatherer card database](https://gatherer.wizards.com/)
- [Magic rules and documentation](https://magic.wizards.com/en/rules)
- [Delve Fonts: Beleren](https://delvefonts.com/custom/beleren/)

---

## 16. QA checklist for Claude Code

Before shipping an MTG-related implementation, confirm:

- [ ] The active plane and era are explicit.
- [ ] Current lore claims are sourced or marked as uncertain.
- [ ] Main-universe and alternate versions are visually labeled.
- [ ] Color choices reflect philosophy, not simplistic morality.
- [ ] W-U-B-R-G order is preserved where the full wheel appears.
- [ ] Color is not the only carrier of meaning.
- [ ] Rules text is not casually paraphrased where exactness matters.
- [ ] Typography has legal fallbacks and readable body settings.
- [ ] No official-looking logo, frame, symbol, or card counterfeit was invented.
- [ ] The interface remains legible without texture, animation, or glow.
- [ ] Mobile, keyboard, screen-reader, and reduced-motion states are covered.
- [ ] Set-specific styling is loaded from a separate set reference.

