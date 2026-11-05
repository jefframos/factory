# UI kit guide

How to build screens from the Layer Lab pack in `library3d/2d/ResourcesData`. `Preview/` has its screens: copy those, they look right.

`sprites.json` (rebuild with `node tools/ui-kit/build-catalog.mjs`) has one line per sprite, measured from its pixels:

- `size`: `[w, h]`
- `slice`: `[left, top, right, bottom]` nine-slice borders. `null` on an axis means it has no uniform band, so don't stretch it that way.
- `stretch`: `both`, `x`, `y` or `none`
- `tint`: `white` means greyscale and meant to be tinted. Untinted it shows as a plain white shape.

Look a sprite up with `grep Menu_BottomBtn tools/ui-kit/sprites.json`.

**Check `slice` by eye on gradient sprites.** It picks the longest uniform band, which can be the wrong one. Sprites corrected by hand are listed under Recipes.

## Rules

1. Most frames are white. Always tint them. The black outlines stay black under a tint.
2. Containers and active tabs are blue, bars are dark slate. Nothing large stays white.
3. Prefer full-colour icons: `IconMisc/Icon_*`, `Icon_ItemIcons/128/ItemIcon_*`, `Demo/Demo_ItemIcon`. `Icon_PictoIcons` and `PictoBorder` are flat white, so only use them on a dark or coloured button.
4. Don't stretch a sprite past its corners. Draw it at a scale instead: the sprites are authored for a 1080-wide screen, so 0.6-0.7 suits a 720-wide design.
5. Some sprites have `.Png` extensions. Rename to `.png` when copying into `raw-assets/images/ui{tps}/`.

## Recipes (slices are `[left, top, right, bottom]`)

| Element | Sprites | Slice | Tint / notes |
| --- | --- | --- | --- |
| Bottom bar | `Button/Menu_BottomBtn_Bg` (4x9) | `[0,6,0,1]` (catalog's is wrong) | `0x2b2d4d`. Black top line is built in |
| Active tab | `Button/Menu_BottomBtn_TabFocus` (54x27) | `[25,25,25,0]` | `0x4a6ef5`, rises above the bar |
| Active tab shine | `Button/Menu_BottomBtn_TabFocus_Light` | `[20,29,20,0]` | `0x86a2ff`, inset 5 over the tab |
| Tabs | Icon only; name only on the active one, icon raised and bigger | | See `1_Lobby` |
| Home icon | `IconMisc/Icon_Castle` | none | Full colour |
| Resource pill | `UI_Etc/ResourceBar_Single_Bg` + `ResourceBar_Single_Icon_Coin` | `[11,11,11,11]` | Tint dark, `0x1c1d33` |
| Title ribbon, any width | `Label/Title_Ribbon04_Red` (540x143) | `[150,0,150,0]` | Left and right ends fixed, scale 0.6 |
| Title ribbon, fixed | `Label/Title_Ribbon01_<Colour>` (304x143) | none | Never stretch, uniform scale only |
| Header bar | `Frame/PanelFrame03_Bg` (4x19) | `[0,8,0,4]` | Dark slate `0x34365a`, 94 tall at scale 1 |
| Count on a header bar | `Frame/PanelFrame03_Oblique` (32x94) | `[30,0,0,0]` | Pale blue, dark text, right edge. See `5_Collection_List` |
| Shop card | `Frame/CardFrame03_n_Bg` + `CardFrame03_n_InnerBg` | `[30,29,30,33]`, `[18,18,18,18]` | Outer `0x3f8cff`, inner `0x93c2ff`. See `13_Shop_1` |
| Text button | `Button/Button01_l_<Colour>` (80x142) | `[38,42,38,70]` at scale 0.5 | Needs at least 56 tall, or a smaller scale. `Gray` for disabled, not alpha |
| Big PLAY button | `Button/Button_Tapered_Yellow` (185x194) | `[82,0,82,0]` | Scale to height. Dark text, no outline |
| Small dark button | `Button/Button_Round03_Dark` (130x122) | `[20,19,20,21]` | |
| Lock on dark | `IconMisc/Icon_Lock01_l` | none | White, full colour |
| Lock badge | `IconMisc/Icon_Lock03` | none | Gold |
| Worn or done | `IconMisc/Icon_Check03_l` | none | Green |

## Which preview for which screen

| Screen | Preview |
| --- | --- |
| Main screen and tabs | `1_Lobby`, `1_Lobby_Menu` |
| Shelf of collectibles | `5_Collection_List` |
| Shop cards with prices | `13_Shop_1`, `13_Shop_2` |
| Area or stage select | `4_Play_Stage_Select_*` |
| Win screen | `9_Play_StageClear`, `9_Play_Result_Victory` |
| Lose screen | `9_Play_Result_Defeat` |
| Every component on one sheet | `0_Component_0` to `0_Component_7` |
