import type { AutonomyMode } from "@hexagons/settings";

export abstract class AutonomyModeProvider {
  abstract getAutonomyMode(): AutonomyMode;
}
