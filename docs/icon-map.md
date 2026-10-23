# Icon map

DOM UI icons under `resources/images/` now hold Lucide SVG markup (`lucide-static`, stroke width 1.75, 24x24).
Colours are concrete because `currentColor` does not work inside `<img>`.

| Old file                          | Lucide icon        | Stroke colour |
| --------------------------------- | ------------------ | ------------- |
| `AllianceIcon.svg`                | `handshake`        | `#28900b`     |
| `AllianceIconWhite.svg`           | `handshake`        | `#ffffff`     |
| `AllianceRequestBlackIcon.svg`    | `user-plus`        | `#000000`     |
| `AllianceRequestWhiteIcon.svg`    | `user-plus`        | `#ffffff`     |
| `BackIconWhite.svg`               | `arrow-left`       | `#ffffff`     |
| `BattleshipIconWhite.svg`         | `ship`             | `#ffffff`     |
| `BoatIconWhite.svg`               | `sailboat`         | `#ffffff`     |
| `BuildIconWhite.svg`              | `hammer`           | `#ffffff`     |
| `ChatIconWhite.svg`               | `message-circle`   | `#ffffff`     |
| `CityIconWhite.svg`               | `building-2`       | `#ffffff`     |
| `ClaimIcon.svg`                   | `flag`             | `#000000`     |
| `CrownIcon.svg`                   | `crown`            | `#feea4f`     |
| `DestroyerIconWhite.svg`          | `ship`             | `#ffffff`     |
| `DisconnectedIcon.svg`            | `wifi-off`         | `#049cdc`     |
| `DonateGoldIconWhite.svg`         | `hand-coins`       | `#ffffff`     |
| `DonateTroopIconWhite.svg`        | `hand-helping`     | `#ffffff`     |
| `DoomsdayClockSkull.svg`          | `skull`            | `#191919`     |
| `EmbargoBlackIcon.svg`            | `ban`              | `#000000`     |
| `EmbargoWhiteIcon.svg`            | `ban`              | `#ffffff`     |
| `EmojiIconWhite.svg`              | `smile`            | `#ffffff`     |
| `ExitFullscreenIconWhite.svg`     | `minimize-2`       | `#ffffff`     |
| `ExitIconWhite.svg`               | `log-out`          | `#ffffff`     |
| `FactoryIconWhite.svg`            | `factory`          | `#ffffff`     |
| `FastForwardIconSolidWhite.svg`   | `fast-forward`     | `#ffffff`     |
| `FullscreenIconWhite.svg`         | `maximize-2`       | `#ffffff`     |
| `GoldCoinIcon.svg`                | `coins`            | `#efb82e`     |
| `GuildIconWhite.svg`              | `castle`           | `#ffffff`     |
| `InfoIcon.svg`                    | `info`             | `#52b620`     |
| `LeaderboardIconRegularWhite.svg` | `trophy`           | `#ffffff`     |
| `LeaderboardIconSolidWhite.svg`   | `trophy`           | `#ffffff`     |
| `LinkIconWhite.svg`               | `link`             | `#ffffff`     |
| `MedalIconWhite.svg`              | `medal`            | `#ffffff`     |
| `MIRVIcon.svg`                    | `zap`              | `#ffffff`     |
| `MissileSiloIconWhite.svg`        | `rocket`           | `#ffffff`     |
| `MushroomCloudIconWhite.svg`      | `radiation`        | `#ffffff`     |
| `NukeIconRed.svg`                 | `bomb`             | `#ff0000`     |
| `NukeIconWhite.svg`               | `bomb`             | `#ffffff`     |
| `PauseIconWhite.svg`              | `pause`            | `#ffffff`     |
| `PlayIconWhite.svg`               | `play`             | `#ffffff`     |
| `PlutoniumIcon.svg`               | `atom`             | `#22c55e`     |
| `PortIcon.svg`                    | `anchor`           | `#ffffff`     |
| `ProfileIcon.svg`                 | `user`             | `#ffffff`     |
| `ReplayRegularIconWhite.svg`      | `rotate-ccw`       | `#ffffff`     |
| `SamLauncherIconWhite.svg`        | `radar`            | `#ffffff`     |
| `SettingIconWhite.svg`            | `settings`         | `#ffffff`     |
| `ShieldIconWhite.svg`             | `shield`           | `#ffffff`     |
| `SirenIconWhite.svg`              | `siren`            | `#ffffff`     |
| `SoldierIcon.svg`                 | `person-standing`  | `#000000`     |
| `SoldierIconAquarius.svg`         | `person-standing`  | `#3fa9f5`     |
| `StopIconWhite.svg`               | `octagon-x`        | `#ffffff`     |
| `SwordIcon.svg`                   | `swords`           | `#000000`     |
| `SwordIconWhite.svg`              | `swords`           | `#ffffff`     |
| `TargetIcon.svg`                  | `target`           | `#ec1b2d`     |
| `TargetIconWhite.svg`             | `target`           | `#ffffff`     |
| `TeamIconRegularWhite.svg`        | `users`            | `#ffffff`     |
| `TeamIconSolidWhite.svg`          | `users`            | `#ffffff`     |
| `TradeShipIconWhite.svg`          | `container`        | `#ffffff`     |
| `TradingIconWhite.svg`            | `arrow-left-right` | `#ffffff`     |
| `TraitorIcon.svg`                 | `user-x`           | `#d40000`     |
| `TraitorIconLightRed.svg`         | `user-x`           | `#ff2d2d`     |
| `TraitorIconWhite.svg`            | `user-x`           | `#ffffff`     |
| `TreeIconWhite.svg`               | `tree-pine`        | `#ffffff`     |
| `UpperLimitIcon.svg`              | `arrow-up-to-line` | `#000000`     |
| `XIcon.svg`                       | `x`                | `#ffffff`     |

## Not swapped

- `CityIcon.svg`: no DOM reference; only named in `EffectPreview.ts` as the structure atlas glyph source.
- `BottleCapIcon.svg`: in-game currency mark with no Lucide match.
- Logos, flags, backgrounds, map previews, help screenshots, cosmetics and `resources/atlases/`: not icons, or atlas inputs.
