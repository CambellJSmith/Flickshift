Sliding Block Journey — direct flick controls build

Open index.html in a modern web browser.

Core puzzle rules:
- Every playable floor cell is occupied except for exactly one empty cell.
- Dark striped cells and missing sections are not playable cells.
- A large proportion of the pieces are two-cell blocks.
- Multiple distinct two-cell blocks are required by the verified solution.
- Every map starts solved and is scrambled through legal reversible moves.
- The reverse route is replayed before a map is accepted.
- Completing a level increases the board from 4 x 4 to 5 x 5, 6 x 6, and onward.

Controls:
- Flick or swipe a block directly in the direction it should move.
- There is no select-then-move step and no on-screen direction pad.
- For keyboard accessibility, focus a block with Tab, then use arrows or WASD.
- After five seconds without a move, the next correct piece pulses and displays its direction.
- Type Cody at any time to watch the game solve itself step by step.

Game juice:
- Grid-exact slide animations with squash, overshoot, and movement trails.
- Different movement sounds for normal, long, and target blocks.
- Impact rings, sparks, target particles, screen flashes, and mobile vibration.
- Invalid-move shake and low error tone.
- Flow multiplier for quick consecutive moves.
- Animated goal, empty cell, selected piece, board aura, and title treatment.
- Juiced hint feedback with a directional arrow and chime.
- Secret-code activation banner and special sound.
- Confetti burst, victory chord, screen flash, board blast, and level-clear banner.
- Staggered board entrance and level announcements.
- Sound can be disabled with the Sound On / Sound Off button.
- Reduced-motion browser preferences are respected.

Files:
- index.html
- styles.css
- script.js
- README.txt

- The green goal marker is rendered above blocks, so it is always visible.

Maximum juice additions:
- Flick charge feedback and velocity-scaled effects.
- Directional speed lines, block afterimages, empty-space vortexes, and edge flashes.
- Board tilt, target-to-goal energy tethers, goal reactions, and heavy long-block impacts.
- Momentum and goal-heat meters with escalating flow ranks.
- Flow milestone bursts, richer audio layers, stronger victory rays, and expanded particles.
- All effects respect reduced-motion preferences and do not alter puzzle state.


Optimization pass:
- Momentum and goal-heat bars were removed.
- The board DOM is built once per level instead of rebuilt after every move.
- Piece positions and the single empty cell are updated incrementally.
- Runtime collision checks use a compact typed-array occupancy grid.
- Piece lookup uses cached maps instead of repeated array scans and DOM queries.
- Flick previews are limited to one update per animation frame.
- Particles, speed lines, trails, rings, and afterimages share one canvas renderer.
- Continuous ambient animations were removed; effects now run only in response to play.
- Large-board intro animation is capped to avoid hundreds of simultaneous animations.
