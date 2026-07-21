# Image brief for the app demo's "try an example night" icons

**Date:** 2026-07-20
**For:** Ida, if she wants to upgrade the app's example-night icons beyond the
simple hand-coded SVGs currently shipped (`js/app.js`, `EXAMPLE_ICONS`)
**Companion to:** `field_work/main_intervention/slides/2026-07-15_gemini_image_brief.md`,
the brief used for the four session decks. This one reuses the exact same
preamble so the app's illustrations match the decks' established visual
identity, if that consistency is wanted.

## Why this file exists

The app currently ships three small hand-drawn SVG icons next to its
"try an example night" preset buttons (a bed with worry-swirls, a window
with heat and noise lines, a sun with a dozing figure). Ida asked whether
richer illustrations were possible and, if a more advanced model was
needed, wanted just the prompt text to use herself (ChatGPT/DALL-E, or
Gemini to match the decks). These are that prompt text. **Nothing here is
required**: the SVG icons already shipped work and cost nothing. This is
only for if a richer, storybook-style look is wanted later.

Format note: these are small icons sitting inline next to a button label
on a phone screen, not full-page slide illustrations, so square (SQ)
compositions are specified throughout, and any generated image would need
to be cropped and shrunk substantially (roughly 36x36 to 64x64 px
displayed) before use, likely cropping in on the single clearest part of a
richer scene rather than using the whole illustration at that size.

## Paste this preamble before EVERY prompt (identical to the decks' brief)

> Warm hand-drawn storybook illustration with soft outlines and gentle texture (not flat corporate vector art, not photorealistic). No text, letters, numbers, or labels anywhere in the image.
>
> SETTING (very important, follow exactly): a dense informal settlement in Nairobi, Kenya, where housing is a single multipurpose room of about 3 by 3 meters. Walls: corrugated iron sheets on a timber frame, or rough worn plaster; unpainted or faded. Roof: corrugated iron sheets, sometimes visible from inside. Floor: bare concrete or packed earth, perhaps a small woven mat. Sleeping: a thin foam mattress on a simple handmade wooden base low to the ground, or a sleeping mat on the floor; bedding is a plain blanket and a colorful kanga/leso cloth. Furnishings: one or two simple wooden stools or a plastic chair, a small wooden table, clothes hanging from a line or nails on the wall, a curtain or hanging cloth dividing the room, yellow jerrycans for water, a plastic basin, a small charcoal jiko stove, a paraffin lamp or a single bare bulb on a wire. Window: one small unglazed or shuttered opening, or none. Outside: narrow packed-earth lanes between closely packed iron-sheet homes, dense rooftops to the horizon, tangled power lines, clothes drying between buildings.
>
> DO NOT DRAW: framed beds with headboards, double beds, mattresses thicker than a hand, nightstands, bedside lamps on tables, dressers, wardrobes, sofas, large glazed windows with curtain rods, tiled or wooden floors, spacious rooms, gardens, lawns, wide paved streets, detached houses with yards, or anything that looks like a middle-class home.
>
> PEOPLE: Black Kenyan adults, drawn respectfully and warmly, never caricatured. Clean, simple, neat clothing (t-shirts, kitenge/kanga prints, headwraps); tidy appearance. The home is materially poor; the person is dignified and composed.
>
> COLOR: warm palette anchored in deep navy #1F3557, teal #0F7173, warm gold #C9A227, muted maroon #7A1F2B, warm sand #F7F3EA, with the warm browns and grays of iron sheets and timber.

Generate all three in one conversation so the style stays consistent.

## The three prompts

1. **Worried before a shift** (SQ). Filename suggestion `app_ex1_worry_work.png`.
   Night inside the single room: a man lying on the low wooden-based
   mattress, eyes open, one arm behind his head, small worry-thought
   swirls drawn rising from his temple toward the iron-sheet roof. A
   battered wind-up alarm clock sits on the floor beside the mattress.
   Paraffin lamp turned low. Restless, not distressed.

2. **Hot, noisy night by the matatu stage** (SQ). Filename suggestion
   `app_ex2_hot_noisy_room.png`. Interior seen through the small window
   opening: faint heat-shimmer lines near the opening, a woman lying
   awake on her mattress fanning herself with a piece of card. Outside
   through the opening, a colorful matatu pulling in at a stage just down
   the lane, headlights and a few waiting figures, motion and sound lines
   suggesting engine noise and chatter reaching into the room.

3. **Napped after a long shift** (SQ). Filename suggestion
   `app_ex3_napped_shift.png`. A man in simple work clothes (faded
   overalls or a plain shirt) dozing while sitting upright on a wooden
   stool just inside his doorway in the early afternoon, head tipped, sun
   high and bright in the lane outside. A small enamel mug of untouched
   tea sits beside him. Keep the light bright and the outdoor bustle
   (a neighbor passing, hung laundry) visible past the doorway so it
   reads as a daytime nap, not nighttime sleep.

## If these get generated

Drop the files anywhere in `field_work/main_intervention/app_demo/icons/`
and ask for them to be wired in; swapping `EXAMPLE_ICONS`' inline SVGs for
`<img>` tags pointing at these files is a small, contained change.
