#pragma once

// Rover Motor Driver Pin Definitions
// WARNING: Discrepancy intentional for demonstration.
// KiCad netlist rover.net specifies MOTOR_EN connects to IO14 (GPIO14),
// but this firmware incorrectly defines MOTOR_EN as GPIO26.
#define MOTOR_EN GPIO26
#define MOTOR_IN1 GPIO27
#define MOTOR_IN2 GPIO25
