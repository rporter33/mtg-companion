# Magic: The Gathering — Reality Fracture Set Reference for Claude Code

> **Official title:** *Reality Fracture*
> **User alias to recognize:** “Shattered Reality”
> **Set code:** `FRA`
> **Commander set code:** `FRC`
> **Special Guests code:** `SPG`
> **Tabletop release:** 2026-10-02
> **Freshness:** 2026-09-17, during preview season
> **Spoiler warning:** This document describes the premise, world, mechanics, treatments, and story setup.

## 0. Instructions to the implementing agent

1. Use **Reality Fracture** in all user-facing titles. Accept “Shattered Reality” as an input alias only.
2. Load `MTG_UNIVERSE_AND_DESIGN_REFERENCE.md` first for the base franchise system; this file overrides it for set-specific mood, tokens, terminology, and motifs.
3. Treat exact colors below as an **implementation palette inferred from public promotional imagery**, not an official Wizards brand guide.
4. No official set-specific retail font specification has been published in the sources reviewed. Treat the set logo as custom lettering/artwork. Use supplied licensed assets if present; otherwise use the fallback font system below.
5. The set was still in preview season when this guide was written. Re-check official sources before presenting a complete card list, story ending, legality change, price, or availability claim.

---

## 1. One-sentence identity

**A blue mind mage tries to replace a scarred Multiverse with his calculated utopia, producing a mirrored reality where familiar people, histories, colors, and institutions return as elegant but unstable opposites.**

The core tension is not “random broken dimensions.” It is **designed perfection becoming coercive unreality**.

---

## 2. Canon premise

Jace Beleren attempted to imagine a Multiverse without its defining catastrophes: no Phyrexians, no Eldrazi, no Nicol Bolas. After his original plan and his own identity fractured, the remaining dominant self—the **Theorist**—constructed the **Echoverse** from the Meditation Realm.

The Echoverse reproduces planes while excising selected people or events judged too harmful. It then develops semi-autonomously. Removing pivotal causes produces paradoxes and unstable histories. To stabilize the Echoverse, the Theorist intends to overlay it on the existing Multiverse: the new reality's “skin” over the old reality's “bones.”

### Moral and thematic engine

- Noble premise: prevent trauma and multiversal catastrophe.
- Fatal method: erase agency, memory, history, and lives.
- Blue-centered flaw: treating existence as a solvable optimization problem.
- Visual contradiction: pristine order made from fractures, surveillance, and impossible geometry.
- Narrative question: if suffering shaped a person, what remains when the suffering is removed—and who has the right to decide?

Do not portray the Theorist as merely insane. Official material characterizes him as coldly logical, grandiose, wounded, coercive, and stripped of dissenting/empathic parts of himself.

---

## 3. World vocabulary

| Term | Meaning | Visual cue |
|---|---|---|
| Echoverse | Jace's alternate Multiverse | mirrored pairings, precise blue energy, duplicated silhouettes |
| The Theorist | Dominant Jace self directing the project | hood, eye/sigil, blue-violet control, monumental presence |
| Echoed pair | A known figure/concept paired with an alternate counterpart | diptych, reflection, opposing colors, shared anchor detail |
| Echoverse Arcavios | Alternate form of Arcavios, created in unstable flux | austere magical academy, warped landscapes, battle readiness |
| Hexhaven Academy | Echoverse counterpart to Strixhaven; regimented battlemage academy | vertical fortress-school, badges, uniforms, five schools |
| Theorist's Tower | Impossible tower atop a leyline confluence | verticality, folding floors, recursive portals, non-Euclidean space |
| Eradia | Reality-blasted wasteland surrounding the tower | ash, broken angles, hostile magic-eating fauna |
| Folioplex | Monitored archive of research and dangerous knowledge | dim stacks, controlled access, watching figures |
| Sanctum | The Theorist's inner conceptual/memory architecture | Ravnican fragments, memory-prisons, intrusive typography |

---

## 4. Primary visual thesis

### Three simultaneous layers

1. **Cerebral control:** indigo, diagrams, measured grids, ritual circles, archival systems.
2. **Fracture:** mirror shards, split portraits, chromatic offsets, impossible angles, broken continuity.
3. **Counterfeit perfection:** silver-white surfaces, luminous symmetry, monumental clean forms that reveal coercion on closer inspection.

### Key motifs

- mirrored or paired faces;
- refracted eye imagery;
- hooded silhouettes and surveillance creatures;
- towers, portals, rings, apertures, nested frames;
- split color identity;
- ink/paint interrupted by glasslike facets;
- impossible geometry and rotated gravity;
- precise equations dissolving at the edge;
- paired words with one term altered;
- vertical panoramas and continuous multi-card scenes.

### Do not use as the main concept

- generic rainbow glitch;
- multiverse superhero portals;
- clean science-fiction holograms without fantasy materials;
- shattered glass on every surface;
- psychedelic chaos without Jace's controlling intelligence;
- purple-only theming; the set still contains all five mana colors and five two-color schools.

---

## 5. Set palette

These tokens are original digital approximations derived from the public key art, product presentation, Jace's established visual language, and described environments. Validate against supplied official assets when available.

### 5.1 Core set palette

| Token | Hex | Role |
|---|---:|---|
| `--rf-void` | `#080812` | Page base; the unstable outside |
| `--rf-ink` | `#111326` | Primary panels |
| `--rf-indigo` | `#24245F` | Structural blue-violet |
| `--rf-jace` | `#3E5FD1` | Primary identity/accent |
| `--rf-azure` | `#6FA7FF` | Active magic, focus, links |
| `--rf-cyan` | `#77E4EF` | Refraction edge and energized geometry |
| `--rf-amethyst` | `#8B5DDB` | Paradox, portal, Echoverse accent |
| `--rf-magenta` | `#D05AAE` | Chromatic fracture highlight; use sparingly |
| `--rf-mirror` | `#D8E2F0` | Silver glass, primary light text |
| `--rf-white` | `#F3F2F7` | Peak highlights |
| `--rf-slate` | `#7C849F` | Secondary text, inactive geometry |
| `--rf-warning` | `#E65B55` | Reality failure, destructive divergence |
| `--rf-gold` | `#C6A45B` | Rarity, ceremony, controlled premium accent |

### 5.2 Gradient recipes

```css
:root {
  --rf-gradient-sanctum:
    radial-gradient(circle at 50% 0%, #3E5FD1 0%, #24245F 35%, #080812 78%);
  --rf-gradient-fracture:
    linear-gradient(115deg, #77E4EF 0%, #6FA7FF 30%, #8B5DDB 66%, #D05AAE 100%);
  --rf-gradient-mirror:
    linear-gradient(145deg, rgba(243,242,247,.92), rgba(111,167,255,.28) 40%, rgba(139,93,219,.22) 70%, rgba(8,8,18,.15));
}
```

Use gradients inside borders, glints, portals, and selected states. Large rainbow backgrounds weaken the set identity.

### 5.3 School palettes

Hexhaven's five schools represent **allied** color pairs, contrasting Strixhaven's enemy-color colleges.

| School | Pair | Discipline | Suggested accents |
|---|---|---|---|
| Fatehold | White–Blue | Future History: divination, prophecy, strategic control | ivory `#E9E1C8`, sky `#72A9D8`, brass `#B8A064` |
| Theorix | Blue–Black | Esoteric Mathematics: paradox, impossible geometry, portals | cobalt `#3158B8`, void `#15111E`, violet `#764FC2` |
| Stingerquill | Black–Red | Painful Words: battle poetry, curses, emotional manipulation | plum-black `#21151F`, crimson `#B83D4A`, hot rose `#D86A83` |
| Konstrari | Red–Green | Constructive Arts: architecture, sculpture, puppetbeasts | terracotta `#B75537`, forest `#426C45`, heartwood amber `#D08B3D` |
| Vigorbloom | Green–White | Invasive Healing: botanical medicine, graft surgery | leaf `#5D8A55`, surgical ivory `#E8E2CE`, sap `#B9C95A` |

Each school should still sit within the indigo/silver master shell so the application reads as one set.

---

## 6. Typography

### 6.1 What is known

- Base modern Magic card titling uses the proprietary **Beleren** family.
- Card rules copy uses a Plantin-style serif system.
- The *Reality Fracture* logo is custom display artwork. Do not infer that its lettering is an installable retail typeface.
- No official public document located for this guide specifies a unique Reality Fracture font family.

### 6.2 Licensed-asset path

If the project includes authorized Wizards assets:

1. Use the supplied *Reality Fracture* logo file as artwork, preserving clear space and aspect ratio.
2. Use supplied Beleren/brand font files only within their license and defined roles.
3. Do not recreate missing glyphs, logo lettering, set symbols, or expansion marks by tracing screenshots.

### 6.3 Safe fallback system

```css
:root {
  --rf-font-display: "Cinzel", "Cormorant SC", Georgia, serif;
  --rf-font-theory: "Cormorant Garamond", "Source Serif 4", Georgia, serif;
  --rf-font-interface: "Source Sans 3", Inter, system-ui, sans-serif;
  --rf-font-equation: "IBM Plex Mono", "JetBrains Mono", ui-monospace, monospace;
}
```

Role guidance:

- **Hero/set title fallback:** Cinzel or Cormorant SC, uppercase, 0.04–0.09em tracking; add custom fractured masking in CSS/SVG rather than choosing an illegible “glitch” font.
- **Lore/editorial headings:** Cormorant Garamond semibold; close leading; sentence or title case.
- **Functional UI:** Source Sans 3; medium weights; neutral and crisp.
- **Equations, set codes, coordinates, probability readouts:** IBM Plex Mono.
- **Intrusive Theorist voice:** same serif as normal lore, but altered through scale, alignment, repetition, or interrupted layout—not a horror novelty font.

### 6.4 Type effects

Permitted in display text only:

- duplicate a line at 1–2 px offsets in cyan and magenta at 10–20% opacity;
- clip a heading through 2–4 polygonal facets;
- mirror one short keyword behind itself;
- replace a straight divider with a refracted path;
- animate a brief alignment correction when content appears.

Never apply chromatic aberration to paragraphs, form labels, card rules, or accessibility-critical text.

---

## 7. Hexhaven Academy

Hexhaven is not a playful school reskin. It is a fortress-academy training cadets as battlemages, healers, protectors, and advisors in a hostile, reality-warped plane.

### Institutional feel

- regimented admission and first-year rotations;
- school selection through exams and dangerous induction trials;
- uniforms and badges bearing the Theorist's eye;
- constant practice, discipline, and mental quieting;
- surveillance presented as safety;
- research access controlled through the Folioplex;
- graduation through a lethal multistage trial;
- school service extends into distant Arcavios settlements.

### Architecture

- one immense vertical campus within the Theorist's Tower;
- floors and walls appear at conflicting orientations;
- staircases can arrive at unexpected levels;
- windows, arches, and gates echo Vryn mage-rings and Jace's insignia;
- the campus becomes stranger nearer the sanctum;
- clean diagrams coexist with worn masonry, workshops, greenhouses, archives, and arenas.

---

## 8. The five schools

### Fatehold — White/Blue

**Future History.** Fatehold divines possible futures, identifies an optimal peaceful state, and works backward to shape history toward it.

- Subjects: history, divination, archival studies, prophecy.
- Magic look: spectral pages, scrolls, mirrored probability chambers.
- Virtue: foresight in service of society.
- Horror: individual futures manipulated for an imposed optimum.
- UI pattern: branching forecasts that collapse into one selected path.

### Theorix — Blue/Black

**Esoteric Mathematics.** Theorix uses arcane equations, theoretical physics, sacrifice, portals, and impossible geometry to transform reality.

- Subjects: arcane mathematics, paradoxology, shadow numbers, manaphysics.
- Magic look: geometric diagrams, ritual circles, gravity wells, black cubes, violet portals.
- Virtue: fearless inquiry and powerful problem-solving.
- Horror: sanity and other realities treated as expendable research material.
- UI pattern: grids folding into cubes, expressions that rewrite adjacent content.

### Stingerquill — Black/Red

**Painful Words.** Stingerquill weaponizes language, emotion, rhythm, and performance.

- Subjects: poetry, composition, emotional psychology, curses, neolinguistics.
- Magic look: spoken glyphs, mouth/heart emphasis, vibrating lines, sharp calligraphy.
- Virtue: expressive power, charisma, speed, self-sufficiency.
- Horror: humiliation, emotional coercion, pain made spectacle.
- UI pattern: reactive text, waveform marks, dueling callouts.

### Konstrari — Red/Green

**Constructive Arts.** Konstrari uses natural materials, craft, instinct, and tether magic to create and pilot puppetbeasts.

- Subjects: anatomy, structural design, carpentry, sculpture, tethermancy.
- Magic look: wood, clay, stone, fabric, heartwood crystals, luminous strings.
- Virtue: audacious creativity grounded in nature.
- Horror/risk: bodily exertion, dangerous scale, lifelong tether, catastrophic prototypes.
- UI pattern: blueprint overlays that assemble into organic silhouettes.

### Vigorbloom — Green/White

**Invasive Healing.** Vigorbloom grows plant matter within bodies to heal, enhance, or attack.

- Subjects: medical botany, hortimancy, graft surgery, phytomancy.
- Magic look: seedlings, roots under skin, surgical greenhouses, luminous sap.
- Virtue: communal care, resilience, life preserved through nature.
- Horror: consent overridden for collective health; healing becomes infestation.
- UI pattern: branching growth meters, clean clinic layouts invaded by roots.

---

## 9. Mechanics and play identity

### 9.1 Empower Jace

A keyword action tied to a nonlegendary blue Jace planeswalker token. If the player controls such a token, empowerment adds the specified loyalty; otherwise it creates the token and then adds loyalty. The token has loyalty abilities associated with surveilling and drawing.

**Design meaning:** Jace's presence propagates through the game. Repeated empowerment concentrates agency into a constructed version of him.

### 9.2 Heartwood tokens

Red-and-green artifact tokens that produce red or green mana.

**Design meaning:** Konstrari turns natural substance and creative life force into crafted infrastructure. Heartwood should look both organic and engineered.

### 9.3 Prepare / prepared

Preparation cards are creatures with a secondary spell panel. When a creature becomes prepared, a copy of its prepare spell exists in exile until cast, the creature leaves, or it becomes unprepared.

**Design meaning:** training and retained tactical options. Interface designs should clearly link the creature, its prepared state, and the exiled spell copy.

### 9.4 Echoed pairs

Every booster contains paired cards showing a main-Multiverse figure/concept and an Echoverse counterpart. A successful pair keeps one recognizable anchor while changing a decisive trait, history, color, or mechanical expression.

Pair design checklist:

1. What is unmistakably the same?
2. What is meaningfully different?
3. Can a newcomer understand the contrast?
4. Does deeper lore reward experienced fans?
5. Does mechanical mirroring reinforce the narrative?

### 9.5 Draft structure

Each mono-color has a core theme that feeds one allied-color Hexhaven pair and one enemy-color planeswalker pair:

| Color | Core theme | Hexhaven pair/theme | Planeswalker pair/theme |
|---|---|---|---|
| White | +1/+1 counters | WU life gain | RW aggro |
| Blue | Empower Jace | UB surveil | GU Jace |
| Black | Graveyard | BR threshold | WB attrition |
| Red | Prowess | RG face burn | UR spellslinger |
| Green | Go big | GW ramp | BG midrange |

This structure is useful for navigation, filters, deck tags, or data visualization.

---

## 10. Card treatments and collectible language

| Treatment | Concept | UI/visual translation |
|---|---|---|
| Standard echoed pairs | Direct paired alternate realities | Linked diptych with shared central axis |
| Borderless echoed pairs | Expanded contrast and character art | Paired full-bleed panels, synchronized hover |
| Shattered mirror cards | Reality/identity broken into bespoke facets | Irregular masks, refracted highlights, limited fragmentation |
| Facet foil | Premium foil version of shattered mirror treatment | Angle-responsive sheen; provide non-motion fallback |
| Braintwister series | Jace/mind-warp visual treatment | cognitive diagrams, constrained surrealism |
| Sculptor's stronghold | Monumental/constructed treatment | stone, statuary, fortification, controlled mass |
| Special Guests panorama | Ten-card continuous looping panorama | circular/looped gallery rather than finite strip |
| Japan Showcase | Hyper-stylized hobby-shop-inspired frame/art | Keep separate from base set shell; do not imitate without assets |
| Secret Lair Bundle promos | Loud, highly individual alternate art direction | Treat as a subcollection, not the default UI language |
| Portal view lands | Cadets and counterparts looking across realities | window/aperture framing |
| Tower basic lands | Three-card vertical panoramas of the tower | stacked vertical scroll/reveal |

---

## 11. Layout system

### 11.1 Global shell

- Dark void background.
- One centered tower/portal axis or asymmetric split.
- Fine silver-blue borders with one intentional discontinuity.
- Layered panels at slight depth; avoid excessive glassmorphism.
- Large negative space interrupted by one fractured object.

### 11.2 Grid

Use a 12-column desktop grid, 8-column tablet, and 4-column mobile. Break the grid only for a theme-bearing moment: mirrored pair overlap, rotated tower fragment, or sanctum intrusion. Most content should remain disciplined so the fracture reads as meaningful.

### 11.3 Mirrored pair component

Desktop:

- two equal panels;
- central 1 px “reality seam” with cyan/violet gradient;
- shared anchor label above;
- differences aligned row-for-row below.

Mobile:

- stack panels;
- keep the seam as a vertical timeline connector;
- use explicit `MULTIVERSE` and `ECHOVERSE` labels.

### 11.4 Tower navigation

Suggested vertical ordering:

1. Fatehold / foundation and futures;
2. communal academy spaces;
3. Konstrari/Vigorbloom/Stingerquill regions as content requires;
4. Theorix near the top;
5. Sanctum as restricted/final content.

This is a thematic navigation metaphor, not a canonical architectural blueprint.

---

## 12. Motion and interaction

### Ordinary interaction

- 180–220 ms.
- slight border refraction on focus.
- 2–4 px lift for cards.
- no continuous background glitch.

### Reality transition

- 420–650 ms maximum.
- duplicate current content, split through a polygon mask, then realign as alternate content.
- keep text stable until transition finishes.
- reduced-motion version: crossfade with seam-color change.

### Tower/paradox interaction

- rotate small geometric layers, not the entire viewport.
- avoid scroll-jacking.
- retain standard back navigation and URL state.

---

## 13. Voice and copy

### Set voice

Controlled, cerebral, intimate, and threatening. Copy should sound as if a trusted expert has decided that consent is an inefficiency.

### Useful verbal fields

- calculate, align, refine, excise, overlay, stabilize;
- echo, mirror, counterpart, possibility, variable;
- fracture, facet, seam, deviation, paradox;
- tower, sanctum, academy, trial, induction, archive;
- memory, identity, dissent, perfection, sacrifice.

### Example original UI copy

- “Compare the life that was with the life that should have been.”
- “One variable remains unresolved.”
- “The tower has corrected your route.”
- “This memory is restricted.”
- “Select a counterpart to reveal the deviation.”

Avoid generic copy such as “Reality is breaking!” unless a more specific Jace/Echoverse idea follows.

---

## 14. Accessibility constraints for fracture effects

- Never fracture functional text into separate DOM reading orders.
- Decorative duplicate text must be `aria-hidden="true"`.
- Refraction overlays must use `pointer-events: none`.
- Portal/tower animations must respect `prefers-reduced-motion`.
- Cyan and violet accents require sufficient contrast against `--rf-void` and `--rf-ink`.
- Label both sides of every echoed pair; do not encode “original” versus “Echoverse” only by left/right position.
- Avoid rapid chromatic flicker and high-frequency glitch effects.

---

## 15. Starter CSS tokens

```css
:root {
  color-scheme: dark;
  --rf-void: #080812;
  --rf-ink: #111326;
  --rf-indigo: #24245F;
  --rf-jace: #3E5FD1;
  --rf-azure: #6FA7FF;
  --rf-cyan: #77E4EF;
  --rf-amethyst: #8B5DDB;
  --rf-magenta: #D05AAE;
  --rf-mirror: #D8E2F0;
  --rf-white: #F3F2F7;
  --rf-slate: #7C849F;
  --rf-warning: #E65B55;
  --rf-gold: #C6A45B;

  --rf-bg: var(--rf-void);
  --rf-surface: var(--rf-ink);
  --rf-text: var(--rf-white);
  --rf-text-muted: #AEB6CE;
  --rf-border: rgba(216, 226, 240, 0.18);
  --rf-border-active: rgba(119, 228, 239, 0.72);
  --rf-focus: #9DD8FF;

  --rf-font-display: "Cinzel", "Cormorant SC", Georgia, serif;
  --rf-font-theory: "Cormorant Garamond", "Source Serif 4", Georgia, serif;
  --rf-font-interface: "Source Sans 3", Inter, system-ui, sans-serif;
  --rf-font-equation: "IBM Plex Mono", "JetBrains Mono", ui-monospace, monospace;

  --rf-radius: 0.625rem;
  --rf-shadow: 0 18px 56px rgba(0, 0, 0, 0.48);
  --rf-seam: linear-gradient(180deg, var(--rf-cyan), var(--rf-amethyst), var(--rf-magenta));
}
```

---

## 16. Implementation recipes

### Hero

- Use a tall negative-space composition.
- Place the title on one side of a vertical fracture seam.
- Place a mirrored subtitle or Theorist statement on the other.
- One portal/tower silhouette; one eye/sigil motif maximum.
- Primary CTA in Jace blue; secondary CTA as silver outline.

### School browser

- Five tabs or nodes ordered WU → UB → BR → RG → GW.
- Each shows disciplines, virtue, horror, art cues, and mechanical theme.
- Master background stays indigo/void while local accents change.

### Echoed-pair explorer

- Default to side-by-side comparison.
- Synchronize zoom and metadata rows.
- Provide a “difference only” view.
- Preserve canonical labels and source links.

### Story page

- Use an archive/document mode with controlled serif typography.
- Allow Theorist interruptions only at major transitions.
- Clearly distinguish quoted canon from original summary.

---

## 17. Do / do not

### Do

- Make control feel more dangerous than chaos.
- Let symmetry break at one deliberate point.
- Show the same identity under changed history.
- Use all five colors within an indigo/silver master system.
- Combine magical academia with military discipline and body/reality horror.
- Keep exact game terminology exact.

### Do not

- Call the set “Shattered Reality” in final UI.
- Treat the Echoverse as a random collection of unrelated universes.
- Make Jace a cackling villain.
- use constant glitch animation;
- claim fallback hex codes or fonts are official;
- imitate official frames, logos, symbols, or foil treatments so closely that unofficial work appears authentic;
- assume previews available on 2026-09-17 constitute the final exhaustive canon.

---

## 18. Official sources

- [Reality Fracture product page](https://magic.wizards.com/en/products/reality-fracture)
- [Planeswalker's Guide to Reality Fracture](https://magic.wizards.com/en/news/magic-story/planeswalkers-guide-to-reality-fracture)
- [Reality Fracture mechanics](https://magic.wizards.com/en/news/feature/reality-fracture-mechanics)
- [Enter the Echoverse with Reality Fracture Design](https://magic.wizards.com/en/news/feature/enter-the-echoverse-with-reality-fracture-design)
- [Collecting Reality Fracture](https://magic.wizards.com/en/news/feature/collecting-reality-fracture)
- [Reality Fracture card image gallery](https://magic.wizards.com/en/products/reality-fracture/card-image-gallery)
- [2026 Magic set announcement](https://magic.wizards.com/en/news/announcements/everything-announced-for-magic-the-gathering-in-2026)
- [Delve Fonts: Beleren](https://delvefonts.com/custom/beleren/)

---

## 19. QA checklist

- [ ] Official set title is **Reality Fracture**.
- [ ] Set code is `FRA`; release date is rechecked if displayed.
- [ ] “Multiverse” and “Echoverse” sides are explicitly labeled.
- [ ] Theorist motivation is understandable and not reduced to madness.
- [ ] Hexhaven reads as a regimented fortress-academy.
- [ ] Five schools use allied pairs and correct disciplines.
- [ ] Master palette remains indigo/silver; school colors are localized.
- [ ] Typography uses licensed files or the documented safe fallbacks.
- [ ] Fracture effects do not harm reading order, contrast, or motion accessibility.
- [ ] Exact mechanics are sourced from the official mechanics article.
- [ ] Preview-season uncertainty is disclosed where completeness matters.
- [ ] Official logos, mana glyphs, set marks, art, and frames are not fabricated.

