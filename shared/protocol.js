// Snapshot row layout (host → phones, ~20/s). One array per rider keeps packets small;
// these names keep both sides honest about which slot is which.

export const R = {
  ID: 0,
  X: 1, // wheel hub position
  Y: 2,
  VX: 3, // velocity, px per physics step
  VY: 4,
  SPIN: 5, // wheel rotation (rad)
  GRAV: 6, // gravity direction (rad, 0 = straight down): tilt + Gravity God twist
  SWAY: 7, // rider rocking from acceleration (rad)
  STATE: 8, // STATE below
  NAME: 9,
  COLOR: 10, // index into PLAYERS
  POSE: 11, // index into POSES
  LEAN: 12, // degrees between rider and ground normal (0 = balanced)
  CP: 13, // last checkpoint index reached
  FINISH_MS: 14, // race time at the flag, or 0
  CRASHES: 15,
  CRASH_SEQ: 16, // bumps on every crash
  CRASH_WHY: 17, // WHY below
  PERFECT_SEQ: 18, // bumps on every perfect landing
  LAND_SEQ: 19, // bumps on every landing (dust / shake)
  LAND_HIT: 20, // how hard the last landing was (px/step into the ground)
  PAD_SEQ: 21, // bumps on every bounce pad
  CRASH_T: 22, // ms since the crash (tumble animation)
  SLOPPY_SEQ: 23, // bumps on every sloppy (speed-losing) landing
  BONK_SEQ: 24, // bumps every time a moving obstacle knocks you back
};

export const STATE = { RACING: 0, FINISHED: 1, CRASHED: 2, GHOST: 3 };
export const WHY = ['WIPEOUT!', 'BAD LANDING!', 'FELL IN!', 'TOO HARD!', 'BONK!'];
