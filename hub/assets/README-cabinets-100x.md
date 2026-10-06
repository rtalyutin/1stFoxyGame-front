# Arcade cabinet geometry100×

The three cabinet GLBs retain the original miniature worlds, palettes, hierarchy, actor names and entry anchors. Each original primitive has exactly100× as many triangles. Dimension-aware bevels round boxes, cylinders have100 radial sides and bevel profiles, and cones have100 radial sides. Crystals retain their authored facets.

| Model | Original instance-counted triangles | Current triangles |
|---|---:|---:|
| runner-forge |1516|151600|
| last-throne |1256|125600|
| syezzhaem |1360|136000|

Editable source: `FoxyGames-Cabinets-100x.blend`, authored and checked in Blender5.2.1LTS. Review cameras, floor, lights and title labels are excluded from the GLB exports. The live renderer continues to draw game titles and animate the original named actors.

Reproduce from the repository root:

```text
blender --background --factory-startup --python-exit-code 1 --python hub/assets/export_cabinets_100x.py
python hub/assets/render_posters.py
npm run hub:typecheck
npm run hub:test
```

The exporter validates triangle counts, original transforms, hierarchy and names before writing the final GLBs. `models.test.ts` imports actual files with Babylon and checks the counts and autonomous actors. `generate_models.py` retains the high-detail cabinets when the native source exists and continues to generate the common fox rig. Intentional baseline overlaps inside the miniatures remain, including the castle roof crystal; there is no claim of scene-wide collision-free geometry.

The default catalog still uses deployment-gated activation. Production builds must preserve the operator-verified live catalog via `HUB_CATALOG_FILE`; updating geometry must not disable currently playable games.
