"use strict";

const starting_board_size = 4;
const target_piece_id = "target";
const level_change_delay = 1800;
const generation_attempt_limit = 72;
const hint_delay = 5000;
const auto_solve_step_delay = 280;
const secret_code = "cody";
const blocked_cell = -2;
const empty_cell = -1;
const move_animation_duration = 240;
const combo_window = 1450;
const maximum_flow = 9;
const maximum_particles = 84;
const maximum_speed_lines = 14;
const maximum_afterimages = 4;
const flick_distance_threshold = 24;
const flick_velocity_threshold = 0.32;
const flick_preview_limit = 44;
const flick_invalid_resistance = 0.24;

const directions = {
	up: { row: -1, column: 0 },
	down: { row: 1, column: 0 },
	left: { row: 0, column: -1 },
	right: { row: 0, column: 1 }
};

const opposite_directions = {
	up: "down",
	down: "up",
	left: "right",
	right: "left"
};

let game_element = null;
let board_element = null;
let board_frame_element = null;
let effects_layer_element = null;
let level_number_element = null;
let board_size_text_element = null;
let move_count_element = null;
let flow_count_element = null;
let flow_rank_element = null;
let momentum_fill_element = null;
let proximity_text_element = null;
let proximity_fill_element = null;
let status_message_element = null;
let restart_button = null;
let sound_button = null;
let level_banner_element = null;
let level_banner_kicker_element = null;
let level_banner_text_element = null;
let toast_layer_element = null;
let direction_buttons = [];

let board_size = starting_board_size;
let level_number = 1;
let generation_number = 0;
let move_count = 0;
let selected_piece_id = null;
let game_won = false;
let level_change_timer = null;
let hint_timer = null;
let auto_solve_timer = null;
let level_data = null;
let pointer_start = null;
let hint_piece_id = null;
let solution_path = [];
let typed_code_buffer = "";
let auto_solving = false;
let sound_enabled = true;
let audio_context = null;
let combo_count = 1;
let last_move_timestamp = 0;
let active_particle_count = 0;
let active_speed_line_count = 0;
let active_afterimage_count = 0;
let last_flow_milestone = 1;
let status_pop_timer = null;

function clone_move(move) {
	return {
		piece_id: move.piece_id,
		direction: move.direction
	};
}

function get_inverse_move(move) {
	return {
		piece_id: move.piece_id,
		direction: opposite_directions[move.direction]
	};
}

function clamp(value, minimum, maximum) {
	return Math.max(minimum, Math.min(maximum, value));
}

function get_flow_rank(flow_value = combo_count) {
	if (flow_value >= 9) {
		return "MAXIMUM";
	}

	if (flow_value >= 7) {
		return "OVERDRIVE";
	}

	if (flow_value >= 5) {
		return "BLAZING";
	}

	if (flow_value >= 3) {
		return "FLOWING";
	}

	return "READY";
}

function clear_hint_timer() {
	if (hint_timer !== null) {
		window.clearTimeout(hint_timer);
		hint_timer = null;
	}
}

function clear_auto_solve_timer() {
	if (auto_solve_timer !== null) {
		window.clearTimeout(auto_solve_timer);
		auto_solve_timer = null;
	}
}

function clear_hint() {
	clear_hint_timer();
	hint_piece_id = null;
}

function get_next_solution_move() {
	if (solution_path.length === 0) {
		return null;
	}

	return get_inverse_move(
		solution_path[solution_path.length - 1]
	);
}

function show_hint() {
	hint_timer = null;

	if (game_won || auto_solving || !level_data) {
		return;
	}

	const next_move = get_next_solution_move();

	if (!next_move) {
		return;
	}

	hint_piece_id = next_move.piece_id;
	render_board();
	status_message_element.textContent =
		"Hint: the pulsing block is the next correct move.";
	trigger_hint_feedback(next_move);
}

function schedule_hint() {
	clear_hint_timer();

	if (game_won || auto_solving || !level_data) {
		return;
	}

	hint_timer = window.setTimeout(show_hint, hint_delay);
}

function record_player_move(move) {
	const previous_move = solution_path[solution_path.length - 1];

	if (
		previous_move &&
		previous_move.piece_id === move.piece_id &&
		move.direction ===
			opposite_directions[previous_move.direction]
	) {
		solution_path.pop();
		return;
	}

	solution_path.push(clone_move(move));
}

function process_secret_code_key(key) {
	if (
		typeof key !== "string" ||
		key.length !== 1 ||
		!/[a-z]/i.test(key)
	) {
		if (![
			"Shift",
			"Control",
			"Alt",
			"Meta"
		].includes(key)) {
			typed_code_buffer = "";
		}

		return { matched: false, captured: false };
	}

	const combined = `${typed_code_buffer}${key.toLowerCase()}`;
	let next_buffer = "";

	for (
		let length = Math.min(secret_code.length, combined.length);
		length > 0;
		length -= 1
	) {
		const suffix = combined.slice(-length);

		if (secret_code.startsWith(suffix)) {
			next_buffer = suffix;
			break;
		}
	}

	typed_code_buffer = next_buffer;

	if (typed_code_buffer === secret_code) {
		typed_code_buffer = "";
		return { matched: true, captured: true };
	}

	return {
		matched: false,
		captured: typed_code_buffer.length > 0
	};
}

function finish_auto_solve() {
	clear_auto_solve_timer();
	auto_solving = false;

	if (restart_button) {
		restart_button.disabled = false;
	}
}

function run_auto_solve_step() {
	auto_solve_timer = null;

	if (!auto_solving || game_won || !level_data) {
		finish_auto_solve();
		return;
	}

	const next_move = get_next_solution_move();

	if (!next_move) {
		finish_auto_solve();

		if (target_is_on_goal(level_data)) {
			check_for_win();
		} else {
			status_message_element.textContent =
				"The automatic solution path became unavailable.";
			status_message_element.classList.add("error");
		}

		return;
	}

	const moving_piece = level_data.pieces.find(
		(piece) => piece.id === next_move.piece_id
	);
	const before_rect = get_piece_rect(next_move.piece_id);
	const empty_rect_before = board_element
		.querySelector(".empty_cell")
		?.getBoundingClientRect();
	const target_distance_before = get_target_distance(level_data);

	if (!apply_move(level_data, next_move)) {
		finish_auto_solve();
		status_message_element.textContent =
			"The automatic solution encountered an invalid move.";
		status_message_element.classList.add("error");
		trigger_invalid_feedback();
		return;
	}

	solution_path.pop();
	move_count += 1;
	selected_piece_id = next_move.piece_id;
	render_board();
	trigger_move_feedback(
		next_move,
		moving_piece,
		before_rect,
		target_distance_before,
		true,
		0.82,
		empty_rect_before
	);

	if (target_is_on_goal(level_data)) {
		finish_auto_solve();
		check_for_win();
		return;
	}

	status_message_element.textContent =
		`Cody is solving: ${solution_path.length} moves remaining.`;
	auto_solve_timer = window.setTimeout(
		run_auto_solve_step,
		auto_solve_step_delay
	);
}

function start_auto_solve() {
	if (auto_solving || game_won || !level_data) {
		return;
	}

	auto_solving = true;
	selected_piece_id = null;
	clear_hint();
	restart_button.disabled = true;
	status_message_element.classList.remove("error");
	status_message_element.textContent =
		"Cody activated. Solving step by step...";
	render_board();
	play_cody_sound();
	flash_screen("rgb(167 139 250 / 16%)");
	show_level_banner("SECRET CODE", "CODY");
	show_toast("Automatic solution engaged");
	pulse_status();
	auto_solve_timer = window.setTimeout(
		run_auto_solve_step,
		auto_solve_step_delay
	);
}


function prefers_reduced_motion() {
	return (
		typeof window !== "undefined" &&
		window.matchMedia &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

function get_hint_arrow(direction_name) {
	const arrows = {
		up: "↑",
		down: "↓",
		left: "←",
		right: "→"
	};

	return arrows[direction_name] || "•";
}

function ensure_audio_context() {
	if (
		!sound_enabled ||
		typeof window === "undefined"
	) {
		return null;
	}

	const AudioContextClass =
		window.AudioContext || window.webkitAudioContext;

	if (!AudioContextClass) {
		return null;
	}

	if (!audio_context) {
		audio_context = new AudioContextClass();
	}

	if (audio_context.state === "suspended") {
		audio_context.resume().catch(() => {});
	}

	return audio_context;
}

function play_tone({
	frequency = 320,
	duration = 0.07,
	volume = 0.035,
	type = "sine",
	frequency_end = null,
	delay = 0
} = {}) {
	const context = ensure_audio_context();

	if (!context) {
		return;
	}

	const start_time = context.currentTime + delay;
	const oscillator = context.createOscillator();
	const gain = context.createGain();

	oscillator.type = type;
	oscillator.frequency.setValueAtTime(frequency, start_time);

	if (frequency_end !== null) {
		oscillator.frequency.exponentialRampToValueAtTime(
			Math.max(20, frequency_end),
			start_time + duration
		);
	}

	gain.gain.setValueAtTime(0.0001, start_time);
	gain.gain.exponentialRampToValueAtTime(
		Math.max(0.0002, volume),
		start_time + 0.012
	);
	gain.gain.exponentialRampToValueAtTime(
		0.0001,
		start_time + duration
	);

	oscillator.connect(gain);
	gain.connect(context.destination);
	oscillator.start(start_time);
	oscillator.stop(start_time + duration + 0.025);
}

function play_select_sound(piece) {
	play_tone({
		frequency: piece && piece.target ? 520 : 390,
		frequency_end: piece && piece.target ? 620 : 450,
		duration: 0.055,
		volume: 0.025,
		type: "triangle"
	});
}

function play_move_sound(piece, is_auto_move = false) {
	const is_long = piece && (piece.width === 2 || piece.height === 2);
	const is_target = piece && piece.target;

	play_tone({
		frequency: is_target ? 265 : is_long ? 150 : 205,
		frequency_end: is_target ? 390 : is_long ? 115 : 245,
		duration: is_long ? 0.11 : 0.075,
		volume: is_auto_move ? 0.022 : is_long ? 0.05 : 0.034,
		type: is_long ? "square" : "triangle"
	});

	if (is_target) {
		play_tone({
			frequency: 560,
			frequency_end: 720,
			duration: 0.08,
			volume: 0.018,
			type: "sine",
			delay: 0.025
		});
	}
}

function play_flow_sound(flow_value) {
	if (flow_value < 3) {
		return;
	}

	const base_frequency = 360 + (flow_value * 38);
	play_tone({
		frequency: base_frequency,
		frequency_end: base_frequency * 1.18,
		duration: 0.09,
		volume: 0.018 + (flow_value * 0.002),
		type: "triangle"
	});
	play_tone({
		frequency: base_frequency * 1.5,
		frequency_end: base_frequency * 1.72,
		duration: 0.11,
		volume: 0.012 + (flow_value * 0.0015),
		type: "sine",
		delay: 0.035
	});
}

function play_heavy_impact_sound() {
	play_tone({
		frequency: 92,
		frequency_end: 48,
		duration: 0.16,
		volume: 0.052,
		type: "sine"
	});
}

function play_invalid_sound() {
	play_tone({
		frequency: 130,
		frequency_end: 72,
		duration: 0.12,
		volume: 0.048,
		type: "sawtooth"
	});
}

function play_hint_sound() {
	play_tone({ frequency: 660, duration: 0.08, volume: 0.025, type: "sine" });
	play_tone({ frequency: 880, duration: 0.12, volume: 0.022, type: "sine", delay: 0.075 });
}

function play_cody_sound() {
	[330, 440, 554, 660].forEach((frequency, index) => {
		play_tone({
			frequency,
			frequency_end: frequency * 1.08,
			duration: 0.15,
			volume: 0.03,
			type: "triangle",
			delay: index * 0.07
		});
	});
}

function play_win_sound() {
	[392, 523, 659, 784].forEach((frequency, index) => {
		play_tone({
			frequency,
			frequency_end: frequency * 1.04,
			duration: 0.28,
			volume: 0.045,
			type: index % 2 === 0 ? "triangle" : "sine",
			delay: index * 0.09
		});
	});
}

function set_sound_enabled(enabled) {
	sound_enabled = enabled;

	if (!sound_button) {
		return;
	}

	sound_button.setAttribute(
		"aria-pressed",
		enabled ? "true" : "false"
	);
	sound_button.setAttribute(
		"aria-label",
		enabled ? "Turn sound off" : "Turn sound on"
	);
	sound_button.textContent = enabled ? "Sound On" : "Sound Off";

	if (enabled) {
		ensure_audio_context();
		play_tone({
			frequency: 440,
			frequency_end: 620,
			duration: 0.08,
			volume: 0.025,
			type: "sine"
		});
	}
}

function pulse_status() {
	if (!status_message_element) {
		return;
	}

	status_message_element.classList.remove("status_pop");
	void status_message_element.offsetWidth;
	status_message_element.classList.add("status_pop");

	if (status_pop_timer !== null) {
		window.clearTimeout(status_pop_timer);
	}

	status_pop_timer = window.setTimeout(() => {
		status_message_element.classList.remove("status_pop");
		status_pop_timer = null;
	}, 340);
}

function bump_element(element, class_name = "stat_bump", duration = 340) {
	if (!element) {
		return;
	}

	element.classList.remove(class_name);
	void element.offsetWidth;
	element.classList.add(class_name);
	window.setTimeout(() => element.classList.remove(class_name), duration);
}

function shake_board() {
	if (!board_frame_element || prefers_reduced_motion()) {
		return;
	}

	bump_element(board_frame_element, "board_shake", 310);
}

function bump_board() {
	if (!board_frame_element || prefers_reduced_motion()) {
		return;
	}

	bump_element(board_frame_element, "board_bump", 290);
}

function vibrate(pattern) {
	if (
		typeof navigator !== "undefined" &&
		navigator.vibrate
	) {
		try {
			navigator.vibrate(pattern);
		} catch (error) {
			return;
		}
	}
}

function get_piece_element(piece_id) {
	if (!board_element) {
		return null;
	}

	return board_element.querySelector(
		`.block[data-piece-id="${piece_id}"]`
	);
}

function get_piece_rect(piece_id) {
	const element = get_piece_element(piece_id);
	return element ? element.getBoundingClientRect() : null;
}

function get_rect_center(rect) {
	return {
		x: rect.left + rect.width / 2,
		y: rect.top + rect.height / 2
	};
}

function remove_effect_element(element, delay) {
	window.setTimeout(() => {
		if (element && element.remove) {
			element.remove();
		}
	}, delay);
}

function create_particles(rect, options = {}) {
	if (
		!effects_layer_element ||
		!rect ||
		prefers_reduced_motion()
	) {
		return;
	}

	const center = get_rect_center(rect);
	const requested_count = options.count || 8;
	const available_count = Math.max(
		0,
		maximum_particles - active_particle_count
	);
	const particle_count = Math.min(requested_count, available_count);
	const palette = options.palette || [
		"#67e8f9",
		"#ffffff",
		"#a78bfa"
	];

	for (let index = 0; index < particle_count; index += 1) {
		const particle = document.createElement("span");
		const angle =
			(options.angle ?? Math.random() * Math.PI * 2) +
			((Math.random() - 0.5) * (options.spread ?? Math.PI * 2));
		const distance =
			(options.distance || 46) * (0.55 + Math.random() * 0.75);
		const size = (options.size || 7) * (0.55 + Math.random() * 0.8);
		const duration = 470 + Math.random() * 360;
		const start_x = center.x + (Math.random() - 0.5) * rect.width * 0.55;
		const start_y = center.y + (Math.random() - 0.5) * rect.height * 0.55;

		particle.className = "juice_particle";
		particle.style.left = `${start_x}px`;
		particle.style.top = `${start_y}px`;
		particle.style.setProperty("--particle-x", `${Math.cos(angle) * distance}px`);
		particle.style.setProperty("--particle-y", `${Math.sin(angle) * distance}px`);
		particle.style.setProperty("--particle-size", `${size}px`);
		particle.style.setProperty("--particle-duration", `${duration}ms`);
		particle.style.setProperty(
			"--particle-color",
			palette[index % palette.length]
		);
		particle.style.setProperty(
			"--particle-radius",
			index % 3 === 0 ? "2px" : "50%"
		);
		particle.style.setProperty(
			"--particle-rotation",
			`${120 + Math.random() * 360}deg`
		);

		effects_layer_element.appendChild(particle);
		active_particle_count += 1;
		window.setTimeout(() => {
			particle.remove();
			active_particle_count = Math.max(0, active_particle_count - 1);
		}, duration + 80);
	}
}

function create_impact_ring(rect, color = "#ffffff", size = null) {
	if (!effects_layer_element || !rect || prefers_reduced_motion()) {
		return;
	}

	const center = get_rect_center(rect);
	const ring = document.createElement("span");

	ring.className = "impact_ring";
	ring.style.left = `${center.x}px`;
	ring.style.top = `${center.y}px`;
	ring.style.setProperty("--ring-color", color);
	ring.style.setProperty(
		"--ring-size",
		`${size || Math.max(rect.width, rect.height) * 0.72}px`
	);
	effects_layer_element.appendChild(ring);
	remove_effect_element(ring, 520);
}

function create_move_trail(rect, color) {
	if (!effects_layer_element || !rect || prefers_reduced_motion()) {
		return;
	}

	const trail = document.createElement("span");
	trail.className = "move_trail";
	trail.style.left = `${rect.left}px`;
	trail.style.top = `${rect.top}px`;
	trail.style.width = `${rect.width}px`;
	trail.style.height = `${rect.height}px`;
	trail.style.setProperty("--trail-color", color);
	effects_layer_element.appendChild(trail);
	remove_effect_element(trail, 420);
}

function create_speed_lines(rect, direction_name, intensity = 1, color = "#ffffff") {
	if (
		!effects_layer_element ||
		!rect ||
		prefers_reduced_motion()
	) {
		return;
	}

	const direction = directions[direction_name];

	if (!direction) {
		return;
	}

	const requested_count = Math.round(5 + (intensity * 7));
	const available_count = Math.max(
		0,
		maximum_speed_lines - active_speed_line_count
	);
	const line_count = Math.min(requested_count, available_count);
	const center = get_rect_center(rect);
	const angle = Math.atan2(direction.row, direction.column);

	for (let index = 0; index < line_count; index += 1) {
		const line = document.createElement("span");
		const side_offset = (Math.random() - 0.5) * Math.max(rect.width, rect.height) * 1.15;
		const forward_offset = (Math.random() - 0.5) * 24;
		const perpendicular_x = -direction.row * side_offset;
		const perpendicular_y = direction.column * side_offset;
		const duration = 190 + Math.random() * 170;
		const distance = 42 + (intensity * 34) + (Math.random() * 34);

		line.className = "speed_line";
		line.style.left = `${center.x + perpendicular_x + (direction.column * forward_offset)}px`;
		line.style.top = `${center.y + perpendicular_y + (direction.row * forward_offset)}px`;
		line.style.setProperty("--speed-angle", `${angle}rad`);
		line.style.setProperty("--speed-x", `${direction.column * distance}px`);
		line.style.setProperty("--speed-y", `${direction.row * distance}px`);
		line.style.setProperty("--speed-length", `${22 + Math.random() * 44 + (intensity * 12)}px`);
		line.style.setProperty("--speed-duration", `${duration}ms`);
		line.style.setProperty("--speed-color", color);
		effects_layer_element.appendChild(line);
		active_speed_line_count += 1;
		window.setTimeout(() => {
			line.remove();
			active_speed_line_count = Math.max(0, active_speed_line_count - 1);
		}, duration + 60);
	}
}

function create_afterimages(before_rect, after_rect, color, intensity = 1) {
	if (
		!effects_layer_element ||
		!before_rect ||
		!after_rect ||
		prefers_reduced_motion()
	) {
		return;
	}

	const requested_count = Math.round(2 + intensity * 2);
	const available_count = Math.max(
		0,
		maximum_afterimages - active_afterimage_count
	);
	const image_count = Math.min(requested_count, available_count);

	for (let index = 0; index < image_count; index += 1) {
		const ghost = document.createElement("span");
		const progress = (index + 1) / (image_count + 1);
		const left = before_rect.left + ((after_rect.left - before_rect.left) * progress);
		const top = before_rect.top + ((after_rect.top - before_rect.top) * progress);
		const duration = 260 + (index * 35);

		ghost.className = "block_afterimage";
		ghost.style.left = `${left}px`;
		ghost.style.top = `${top}px`;
		ghost.style.width = `${after_rect.width}px`;
		ghost.style.height = `${after_rect.height}px`;
		ghost.style.setProperty("--afterimage-color", color);
		ghost.style.setProperty("--afterimage-delay", `${index * 18}ms`);
		ghost.style.setProperty("--afterimage-duration", `${duration}ms`);
		effects_layer_element.appendChild(ghost);
		active_afterimage_count += 1;
		window.setTimeout(() => {
			ghost.remove();
			active_afterimage_count = Math.max(0, active_afterimage_count - 1);
		}, duration + (index * 18) + 70);
	}
}

function create_empty_vortex(rect, direction_name, intensity = 1) {
	if (!effects_layer_element || !rect || prefers_reduced_motion()) {
		return;
	}

	const center = get_rect_center(rect);
	const vortex = document.createElement("span");
	const direction = directions[direction_name] || { row: 0, column: 0 };

	vortex.className = "empty_vortex";
	vortex.style.left = `${center.x}px`;
	vortex.style.top = `${center.y}px`;
	vortex.style.width = `${Math.max(rect.width, rect.height) * (0.9 + intensity * 0.18)}px`;
	vortex.style.height = vortex.style.width;
	vortex.style.setProperty("--vortex-x", `${direction.column * 20}px`);
	vortex.style.setProperty("--vortex-y", `${direction.row * 20}px`);
	effects_layer_element.appendChild(vortex);
	remove_effect_element(vortex, 520);
}

function create_edge_flash(direction_name, color, intensity = 1) {
	if (!effects_layer_element || !board_frame_element || prefers_reduced_motion()) {
		return;
	}

	const direction = directions[direction_name];

	if (!direction) {
		return;
	}

	const rect = board_frame_element.getBoundingClientRect();
	const flash = document.createElement("span");
	const horizontal = direction.column !== 0;

	flash.className = `edge_flash edge_${direction_name}`;
	flash.style.setProperty("--edge-color", color);
	flash.style.setProperty("--edge-intensity", String(clamp(intensity, 0.7, 2.2)));
	flash.style.left = `${rect.left}px`;
	flash.style.top = `${rect.top}px`;
	flash.style.width = `${rect.width}px`;
	flash.style.height = `${rect.height}px`;
	flash.dataset.horizontal = horizontal ? "true" : "false";
	effects_layer_element.appendChild(flash);
	remove_effect_element(flash, 430);
}

function create_starburst(rect, color = "#ffffff", intensity = 1) {
	if (!effects_layer_element || !rect || prefers_reduced_motion()) {
		return;
	}

	const center = get_rect_center(rect);
	const burst = document.createElement("span");

	burst.className = "starburst";
	burst.style.left = `${center.x}px`;
	burst.style.top = `${center.y}px`;
	burst.style.width = `${Math.max(rect.width, rect.height) * (1.35 + intensity * 0.45)}px`;
	burst.style.height = burst.style.width;
	burst.style.setProperty("--burst-color", color);
	effects_layer_element.appendChild(burst);
	remove_effect_element(burst, 650);
}

function create_goal_tether(from_rect, to_rect) {
	if (!effects_layer_element || !from_rect || !to_rect || prefers_reduced_motion()) {
		return;
	}

	const from = get_rect_center(from_rect);
	const to = get_rect_center(to_rect);
	const delta_x = to.x - from.x;
	const delta_y = to.y - from.y;
	const distance = Math.hypot(delta_x, delta_y);
	const angle = Math.atan2(delta_y, delta_x);
	const tether = document.createElement("span");

	tether.className = "goal_tether";
	tether.style.left = `${from.x}px`;
	tether.style.top = `${from.y}px`;
	tether.style.width = `${distance}px`;
	tether.style.setProperty("--tether-angle", `${angle}rad`);
	effects_layer_element.appendChild(tether);
	remove_effect_element(tether, 620);
}

function create_victory_rays(rect) {
	if (!effects_layer_element || !rect || prefers_reduced_motion()) {
		return;
	}

	const center = get_rect_center(rect);
	const rays = document.createElement("span");

	rays.className = "victory_rays";
	rays.style.left = `${center.x}px`;
	rays.style.top = `${center.y}px`;
	rays.style.width = `${Math.max(window.innerWidth, window.innerHeight) * 0.72}px`;
	rays.style.height = rays.style.width;
	effects_layer_element.appendChild(rays);
	remove_effect_element(rays, 1050);
}

function animate_board_tilt(direction_name, intensity = 1) {
	if (
		!board_element ||
		prefers_reduced_motion() ||
		!board_element.animate
	) {
		return;
	}

	const direction = directions[direction_name];

	if (!direction) {
		return;
	}

	const tilt_x = direction.row * -2.2 * intensity;
	const tilt_y = direction.column * 2.2 * intensity;
	const shift_x = direction.column * 3.5 * intensity;
	const shift_y = direction.row * 3.5 * intensity;

	board_element.animate(
		[
			{ transform: "perspective(900px) rotateX(0deg) rotateY(0deg) translate(0, 0)" },
			{ transform: `perspective(900px) rotateX(${tilt_x}deg) rotateY(${tilt_y}deg) translate(${shift_x}px, ${shift_y}px)`, offset: 0.42 },
			{ transform: "perspective(900px) rotateX(0deg) rotateY(0deg) translate(0, 0)" }
		],
		{
			duration: 310,
			easing: "cubic-bezier(0.18, 0.9, 0.22, 1)"
		}
	);
}

function excite_goal() {
	const goal_overlay = board_element
		? board_element.querySelector(".goal_overlay")
		: null;

	if (!goal_overlay) {
		return;
	}

	goal_overlay.classList.remove("goal_excited");
	void goal_overlay.offsetWidth;
	goal_overlay.classList.add("goal_excited");
	window.setTimeout(() => goal_overlay.classList.remove("goal_excited"), 620);
}

function show_floating_text(text, rect, class_name = "") {
	if (!effects_layer_element || !rect || prefers_reduced_motion()) {
		return;
	}

	const center = get_rect_center(rect);
	const label = document.createElement("span");
	label.className = `floating_text ${class_name}`.trim();
	label.textContent = text;
	label.style.left = `${center.x}px`;
	label.style.top = `${center.y}px`;
	effects_layer_element.appendChild(label);
	remove_effect_element(label, 920);
}

function flash_screen(color = "rgb(255 255 255 / 18%)") {
	if (!effects_layer_element || prefers_reduced_motion()) {
		return;
	}

	const flash = document.createElement("span");
	flash.className = "screen_flash";
	flash.style.setProperty("--flash-color", color);
	effects_layer_element.appendChild(flash);
	remove_effect_element(flash, 470);
}

function show_toast(text) {
	if (!toast_layer_element) {
		return;
	}

	const toast = document.createElement("div");
	toast.className = "juice_toast";
	toast.textContent = text;
	toast_layer_element.appendChild(toast);
	remove_effect_element(toast, 1500);
}

function show_level_banner(kicker, text, is_win = false) {
	if (!level_banner_element) {
		return;
	}

	level_banner_kicker_element.textContent = kicker;
	level_banner_text_element.textContent = text;
	level_banner_element.classList.remove("show", "win_banner");

	if (is_win) {
		level_banner_element.classList.add("win_banner");
	}

	void level_banner_element.offsetWidth;
	level_banner_element.classList.add("show");
	window.setTimeout(() => {
		level_banner_element.classList.remove("show", "win_banner");
	}, 1050);
}

function get_piece_visual_color(piece) {
	if (piece.target) {
		return "rgb(249 115 22 / 42%)";
	}

	const colors = [
		"rgb(103 232 249 / 34%)",
		"rgb(167 139 250 / 34%)",
		"rgb(249 168 212 / 34%)",
		"rgb(253 230 138 / 34%)",
		"rgb(134 239 172 / 34%)"
	];

	return colors[piece.color % colors.length];
}

function animate_piece_move(
	piece,
	before_rect,
	direction_name,
	is_auto_move = false
) {
	const element = get_piece_element(piece.id);

	if (!element || !before_rect) {
		return;
	}

	const after_rect = element.getBoundingClientRect();
	const delta_x = before_rect.left - after_rect.left;
	const delta_y = before_rect.top - after_rect.top;
	const direction = directions[direction_name];
	const visual_color = get_piece_visual_color(piece);

	create_move_trail(before_rect, visual_color);
	create_impact_ring(
		after_rect,
		piece.target ? "#fb923c" : piece.width === 2 || piece.height === 2
			? "#fde68a"
			: "#ffffff"
	);
	create_particles(after_rect, {
		count: piece.target ? 14 : piece.width === 2 || piece.height === 2 ? 10 : 6,
		distance: piece.target ? 58 : 42,
		size: piece.target ? 8 : 6,
		angle: Math.atan2(direction.row, direction.column),
		spread: Math.PI * 1.15,
		palette: piece.target
			? ["#fb923c", "#fdba74", "#fff7ed"]
			: ["#ffffff", "#67e8f9", "#fde68a"]
	});

	if (!prefers_reduced_motion() && element.animate) {
		element.animate(
			[
				{
					transform: `translate(${delta_x}px, ${delta_y}px) scale(1.03)`,
					filter: "brightness(1.3) saturate(1.2)"
				},
				{
					transform: `translate(${-direction.column * 5}px, ${-direction.row * 5}px) scale(0.96, 1.04)`,
					offset: 0.72
				},
				{
					transform: "translate(0, 0) scale(1)",
					filter: "brightness(1) saturate(1)"
				}
			],
			{
				duration: is_auto_move
					? move_animation_duration * 0.88
					: move_animation_duration,
				easing: "cubic-bezier(0.18, 0.86, 0.24, 1)",
				fill: "none"
			}
		);
	}
}

function get_target_distance(level) {
	const target_piece = level.pieces.find(
		(piece) => piece.id === target_piece_id
	);

	return (
		Math.abs(target_piece.row - level.goal.row) +
		Math.abs(target_piece.column - level.goal.column)
	);
}

function update_juice_dashboard() {
	const momentum_progress = clamp(
		(combo_count - 1) / Math.max(1, maximum_flow - 1),
		0,
		1
	);

	if (momentum_fill_element) {
		momentum_fill_element.style.width = `${momentum_progress * 100}%`;
	}

	if (flow_rank_element) {
		flow_rank_element.textContent = get_flow_rank(combo_count);
	}

	if (game_element) {
		game_element.dataset.flowStage = combo_count >= 7
			? "3"
			: combo_count >= 5
				? "2"
				: combo_count >= 3
					? "1"
					: "0";
	}

	if (!level_data) {
		return;
	}

	const maximum_distance = Math.max(1, (board_size - 1) * 2);
	const distance = get_target_distance(level_data);
	const proximity = clamp(1 - (distance / maximum_distance), 0, 1);
	const proximity_label = target_is_on_goal(level_data)
		? "LOCKED"
		: proximity >= 0.78
			? "BURNING"
			: proximity >= 0.52
				? "HOT"
				: proximity >= 0.28
					? "WARM"
					: "COLD";

	if (proximity_fill_element) {
		proximity_fill_element.style.width = `${proximity * 100}%`;
	}

	if (proximity_text_element) {
		proximity_text_element.textContent = proximity_label;
	}

	if (board_frame_element) {
		board_frame_element.classList.toggle("target_near", proximity >= 0.68);
	}
}

function trigger_flow_milestone(flow_value) {
	const milestone_words = {
		3: "FLOWING!",
		5: "BLAZING!",
		7: "OVERDRIVE!",
		9: "MAXIMUM JUICE!"
	};
	const text = milestone_words[flow_value];

	if (!text || flow_value <= last_flow_milestone) {
		return;
	}

	last_flow_milestone = flow_value;
	play_flow_sound(flow_value);
	const stat_rect = flow_count_element
		? flow_count_element.closest(".game_stat").getBoundingClientRect()
		: board_frame_element.getBoundingClientRect();

	show_floating_text(text, stat_rect, "mega_combo");
	create_starburst(stat_rect, flow_value >= 7 ? "#f9a8d4" : "#fde68a", flow_value / 5);
	create_particles(stat_rect, {
		count: 12 + flow_value * 2,
		distance: 40 + flow_value * 5,
		size: 6 + flow_value * 0.35,
		palette: ["#fde68a", "#f9a8d4", "#67e8f9", "#ffffff"]
	});
	flash_screen(flow_value >= 7
		? "rgb(249 168 212 / 9%)"
		: "rgb(253 230 138 / 8%)");
	show_toast(`${text} Keep flicking`);
	bump_element(game_element, "flow_kick", 480);
}

function update_flow(is_player_move = true) {
	if (!is_player_move) {
		return;
	}

	const now = performance.now();
	const previous_combo = combo_count;

	if (now - last_move_timestamp <= combo_window) {
		combo_count = Math.min(maximum_flow, combo_count + 1);
	} else {
		combo_count = 1;
		last_flow_milestone = 1;
	}

	last_move_timestamp = now;

	if (flow_count_element) {
		flow_count_element.textContent = `×${combo_count}`;
		bump_element(flow_count_element.closest(".game_stat"));
		flow_count_element.closest(".game_stat").classList.toggle(
			"flow_hot",
			combo_count >= 3
		);
	}

	update_juice_dashboard();

	if (combo_count > previous_combo) {
		trigger_flow_milestone(combo_count);
	}
}

function reset_flow() {
	combo_count = 1;
	last_move_timestamp = 0;
	last_flow_milestone = 1;

	if (flow_count_element) {
		flow_count_element.textContent = "×1";
		flow_count_element.closest(".game_stat").classList.remove("flow_hot");
	}

	update_juice_dashboard();
}

function trigger_invalid_feedback(direction_name = "", rect = null) {
	shake_board();
	play_invalid_sound();
	vibrate(26);
	pulse_status();
	flash_screen("rgb(248 113 113 / 8%)");
	create_edge_flash(direction_name, "#f87171", 1.25);
	create_starburst(rect, "#fca5a5", 0.7);
}

function trigger_select_feedback(piece) {
	const rect = get_piece_rect(piece.id);
	play_select_sound(piece);
	create_impact_ring(rect, piece.target ? "#fb923c" : "#bae6fd");
	create_particles(rect, {
		count: piece.target ? 8 : 4,
		distance: 24,
		size: 5,
		palette: piece.target
			? ["#fb923c", "#fff7ed"]
			: ["#bae6fd", "#ffffff"]
	});
}

function trigger_move_feedback(
	move,
	piece,
	before_rect,
	target_distance_before,
	is_auto_move = false,
	input_intensity = 1,
	empty_rect_before = null
) {
	const intensity = clamp(input_intensity, 0.65, 2.2);
	animate_piece_move(
		piece,
		before_rect,
		move.direction,
		is_auto_move
	);
	play_move_sound(piece, is_auto_move);
	bump_board();
	bump_element(move_count_element.closest(".game_stat"));
	vibrate(piece.width === 2 || piece.height === 2 ? 18 : 10);

	const after_rect = get_piece_rect(piece.id);
	const visual_color = get_piece_visual_color(piece);
	create_speed_lines(after_rect, move.direction, intensity, piece.target ? "#fb923c" : "#ffffff");
	create_afterimages(before_rect, after_rect, visual_color, intensity);
	create_empty_vortex(empty_rect_before, move.direction, intensity);
	create_edge_flash(move.direction, piece.target ? "#fb923c" : "#67e8f9", intensity);
	animate_board_tilt(move.direction, intensity);

	if (piece.width === 2 || piece.height === 2) {
		play_heavy_impact_sound();
		create_starburst(after_rect, "#fde68a", 0.65 + intensity * 0.35);
		show_floating_text("THUNK!", after_rect, "heavy");
	}

	if (!is_auto_move) {
		update_flow(true);
	} else {
		update_juice_dashboard();
	}

	if (piece.target) {
		const target_distance_after = get_target_distance(level_data);
		const goal_rect = board_element
			.querySelector(".goal_overlay")
			?.getBoundingClientRect();

		if (target_distance_after < target_distance_before) {
			show_floating_text("CLOSER!", after_rect, "good");
			flash_screen("rgb(249 115 22 / 9%)");
			create_starburst(after_rect, "#fb923c", 1.1 + intensity * 0.25);
			create_goal_tether(after_rect, goal_rect);
			excite_goal();
		} else if (!is_auto_move) {
			show_floating_text("DETOUR", after_rect, "combo");
		}
	} else if (
		!is_auto_move &&
		combo_count >= 3 &&
		combo_count % 2 === 1
	) {
		show_floating_text(
			`FLOW ×${combo_count}`,
			after_rect,
			"combo"
		);
	}

	update_juice_dashboard();
}

function trigger_hint_feedback(next_move) {
	const rect = get_piece_rect(next_move.piece_id);
	play_hint_sound();
	create_impact_ring(rect, "#ffffff");
	create_particles(rect, {
		count: 12,
		distance: 38,
		size: 6,
		palette: ["#ffffff", "#93c5fd", "#c4b5fd"]
	});
	show_toast("The next correct block is pulsing");
	pulse_status();
}

function trigger_win_feedback() {
	const target_rect = get_piece_rect(target_piece_id);
	const board_rect = board_frame_element.getBoundingClientRect();

	play_win_sound();
	create_victory_rays(board_rect);
	create_starburst(target_rect, "#86efac", 2.2);
	create_goal_tether(target_rect, target_rect);
	flash_screen("rgb(134 239 172 / 28%)");
	bump_element(board_frame_element, "win_blast", 900);
	show_level_banner("LEVEL CLEAR", `${move_count} MOVES`, true);
	show_floating_text("GOAL!", target_rect, "good");
	vibrate([35, 30, 55, 30, 80]);

	create_particles(board_rect, {
		count: 108,
		distance: Math.min(window.innerWidth, window.innerHeight) * 0.22,
		size: 9,
		palette: [
			"#4ade80",
			"#67e8f9",
			"#fde68a",
			"#f9a8d4",
			"#ffffff"
		]
	});
}

function animate_board_intro() {
	if (prefers_reduced_motion() || !board_element) {
		return;
	}

	const elements = Array.from(
		board_element.querySelectorAll(".cell:not(.void_cell), .block")
	);
	const maximum_stagger = 360;
	const stagger_step = Math.max(
		3,
		Math.min(18, maximum_stagger / Math.max(1, elements.length))
	);

	elements.forEach((element, index) => {
		if (!element.animate) {
			return;
		}

		element.animate(
			[
				{ opacity: 0, transform: "scale(0.72) translateY(8px)" },
				{ opacity: 1, transform: "scale(1) translateY(0)" }
			],
			{
				duration: 300,
				delay: Math.min(maximum_stagger, index * stagger_step),
				easing: "cubic-bezier(0.2, 0.85, 0.25, 1)",
				fill: "backwards"
			}
		);
	});
}

function get_cell_key(row, column) {
	return `${row},${column}`;
}

function parse_cell_key(cell_key) {
	const parts = cell_key.split(",");

	return {
		row: Number(parts[0]),
		column: Number(parts[1])
	};
}

function get_cell_index(size, row, column) {
	return (row * size) + column;
}

function get_row_from_index(size, index) {
	return Math.floor(index / size);
}

function get_column_from_index(size, index) {
	return index % size;
}

function clone_piece(piece) {
	return {
		id: piece.id,
		row: piece.row,
		column: piece.column,
		width: piece.width,
		height: piece.height,
		color: piece.color,
		target: piece.target
	};
}

function make_seeded_random(seed) {
	let current_seed = seed >>> 0;

	return function random() {
		current_seed += 0x6d2b79f5;
		let value = current_seed;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
}

function shuffle_array(items, random) {
	for (let index = items.length - 1; index > 0; index -= 1) {
		const swap_index = Math.floor(random() * (index + 1));
		const temporary_item = items[index];
		items[index] = items[swap_index];
		items[swap_index] = temporary_item;
	}
}

function is_inside_board(size, row, column) {
	return (
		row >= 0 &&
		row < size &&
		column >= 0 &&
		column < size
	);
}

function get_neighbor_cells(size, row, column) {
	const neighbors = [];

	for (const direction of Object.values(directions)) {
		const next_row = row + direction.row;
		const next_column = column + direction.column;

		if (is_inside_board(size, next_row, next_column)) {
			neighbors.push({
				row: next_row,
				column: next_column,
				key: get_cell_key(next_row, next_column)
			});
		}
	}

	return neighbors;
}

function is_connected(size, cells) {
	if (cells.size === 0) {
		return false;
	}

	const first_key = cells.values().next().value;
	const pending = [first_key];
	const visited = new Set([first_key]);
	let read_index = 0;

	while (read_index < pending.length) {
		const current_key = pending[read_index];
		read_index += 1;
		const current = parse_cell_key(current_key);

		for (
			const neighbor of get_neighbor_cells(
				size,
				current.row,
				current.column
			)
		) {
			if (
				cells.has(neighbor.key) &&
				!visited.has(neighbor.key)
			) {
				visited.add(neighbor.key);
				pending.push(neighbor.key);
			}
		}
	}

	return visited.size === cells.size;
}

function remove_cell_if_safe(
	size,
	playable_cells,
	removed_cells,
	candidate_key,
	minimum_playable_count
) {
	if (
		!playable_cells.has(candidate_key) ||
		playable_cells.size <= minimum_playable_count
	) {
		return false;
	}

	const candidate_cells = new Set(playable_cells);
	candidate_cells.delete(candidate_key);

	if (!is_connected(size, candidate_cells)) {
		return false;
	}

	playable_cells.delete(candidate_key);
	removed_cells.add(candidate_key);
	return true;
}

function create_shape(size, random) {
	const playable_cells = new Set();
	const void_cells = new Set();
	const wall_cells = new Set();

	for (let row = 0; row < size; row += 1) {
		for (let column = 0; column < size; column += 1) {
			playable_cells.add(get_cell_key(row, column));
		}
	}

	const edge_candidates = [];
	const interior_candidates = [];

	for (let row = 0; row < size; row += 1) {
		for (let column = 0; column < size; column += 1) {
			const cell_key = get_cell_key(row, column);

			if (
				row === 0 ||
				column === 0 ||
				row === size - 1 ||
				column === size - 1
			) {
				edge_candidates.push(cell_key);
			} else {
				interior_candidates.push(cell_key);
			}
		}
	}

	shuffle_array(edge_candidates, random);
	shuffle_array(interior_candidates, random);

	const minimum_playable_count = Math.max(
		12,
		Math.floor(size * size * 0.72)
	);
	const desired_void_count = Math.max(
		2,
		Math.min(6, Math.floor(size / 2))
	);
	const desired_wall_count = Math.max(
		1,
		Math.min(5, Math.floor(size / 3))
	);

	for (const candidate_key of edge_candidates) {
		if (void_cells.size >= desired_void_count) {
			break;
		}

		remove_cell_if_safe(
			size,
			playable_cells,
			void_cells,
			candidate_key,
			minimum_playable_count
		);
	}

	for (const candidate_key of interior_candidates) {
		if (wall_cells.size >= desired_wall_count) {
			break;
		}

		remove_cell_if_safe(
			size,
			playable_cells,
			wall_cells,
			candidate_key,
			minimum_playable_count
		);
	}

	return {
		size,
		playable_cells,
		void_cells,
		wall_cells
	};
}

function choose_goal_and_empty(shape, random) {
	const goal_candidates = [];

	for (const cell_key of shape.playable_cells) {
		const cell = parse_cell_key(cell_key);
		const playable_neighbors = get_neighbor_cells(
			shape.size,
			cell.row,
			cell.column
		).filter((neighbor) =>
			shape.playable_cells.has(neighbor.key)
		);

		if (playable_neighbors.length >= 3) {
			goal_candidates.push({
				cell,
				neighbors: playable_neighbors
			});
		}
	}

	if (goal_candidates.length === 0) {
		throw new Error("The shape has no suitable goal cell.");
	}

	shuffle_array(goal_candidates, random);
	const selected_goal = goal_candidates[
		Math.floor(random() * Math.min(8, goal_candidates.length))
	];
	const neighbor_options = selected_goal.neighbors.slice();
	shuffle_array(neighbor_options, random);
	const selected_empty = neighbor_options[0];

	return {
		goal: { ...selected_goal.cell },
		solved_empty: {
			row: selected_empty.row,
			column: selected_empty.column
		}
	};
}

function find_maximum_domino_pairs(available_cells, size, random) {
	const left_cells = [];
	const adjacency = new Map();
	const matched_left_by_right = new Map();

	for (const cell_key of available_cells) {
		const cell = parse_cell_key(cell_key);

		if ((cell.row + cell.column) % 2 !== 0) {
			continue;
		}

		const neighbors = get_neighbor_cells(
			size,
			cell.row,
			cell.column
		)
			.filter((neighbor) => available_cells.has(neighbor.key))
			.map((neighbor) => neighbor.key);

		shuffle_array(neighbors, random);
		left_cells.push(cell_key);
		adjacency.set(cell_key, neighbors);
	}

	shuffle_array(left_cells, random);

	function try_match(left_key, visited_right) {
		for (const right_key of adjacency.get(left_key) || []) {
			if (visited_right.has(right_key)) {
				continue;
			}

			visited_right.add(right_key);
			const previous_left = matched_left_by_right.get(right_key);

			if (
				previous_left === undefined ||
				try_match(previous_left, visited_right)
			) {
				matched_left_by_right.set(right_key, left_key);
				return true;
			}
		}

		return false;
	}

	for (const left_key of left_cells) {
		try_match(left_key, new Set());
	}

	const pairs = [];

	for (const [right_key, left_key] of matched_left_by_right) {
		const left = parse_cell_key(left_key);
		const right = parse_cell_key(right_key);

		pairs.push({
			row: Math.min(left.row, right.row),
			column: Math.min(left.column, right.column),
			width: left.row === right.row ? 2 : 1,
			height: left.column === right.column ? 2 : 1,
			keys: [left_key, right_key]
		});
	}

	shuffle_array(pairs, random);
	return pairs;
}

function create_piece_layout(shape, goal_data, random) {
	const goal_key = get_cell_key(
		goal_data.goal.row,
		goal_data.goal.column
	);
	const empty_key = get_cell_key(
		goal_data.solved_empty.row,
		goal_data.solved_empty.column
	);
	const available_cells = new Set(shape.playable_cells);
	const pieces = [
		{
			id: target_piece_id,
			row: goal_data.goal.row,
			column: goal_data.goal.column,
			width: 1,
			height: 1,
			color: 0,
			target: true
		}
	];
	let next_piece_number = 0;

	available_cells.delete(goal_key);
	available_cells.delete(empty_key);

	const maximum_pairs = find_maximum_domino_pairs(
		available_cells,
		shape.size,
		random
	);
	const selected_pair_count = Math.max(
		2,
		Math.floor(maximum_pairs.length * 0.68)
	);
	const selected_pairs = maximum_pairs.slice(
		0,
		selected_pair_count
	);

	for (const pair of selected_pairs) {
		pieces.push({
			id: `long_${next_piece_number}`,
			row: pair.row,
			column: pair.column,
			width: pair.width,
			height: pair.height,
			color: next_piece_number % 5,
			target: false
		});

		available_cells.delete(pair.keys[0]);
		available_cells.delete(pair.keys[1]);
		next_piece_number += 1;
	}

	for (const cell_key of available_cells) {
		const cell = parse_cell_key(cell_key);

		pieces.push({
			id: `single_${next_piece_number}`,
			row: cell.row,
			column: cell.column,
			width: 1,
			height: 1,
			color: next_piece_number % 5,
			target: false
		});

		next_piece_number += 1;
	}

	const domino_cell_count = selected_pairs.length * 2;
	const available_piece_cells = shape.playable_cells.size - 2;
	const domino_cell_ratio = domino_cell_count / available_piece_cells;

	const minimum_domino_ratio = shape.size === 4 ? 0.34 : 0.42;

	if (domino_cell_ratio < minimum_domino_ratio) {
		throw new Error("The board could not fit enough long blocks.");
	}

	return {
		pieces,
		domino_count: selected_pairs.length,
		domino_cell_ratio
	};
}

function get_piece_cells(piece, row = piece.row, column = piece.column) {
	const cells = [];

	for (let row_offset = 0; row_offset < piece.height; row_offset += 1) {
		for (
			let column_offset = 0;
			column_offset < piece.width;
			column_offset += 1
		) {
			cells.push({
				row: row + row_offset,
				column: column + column_offset
			});
		}
	}

	return cells;
}

function create_search_state(level) {
	const positions = new Int16Array(level.pieces.length * 2);
	const occupancy = new Int16Array(level.size * level.size);
	occupancy.fill(blocked_cell);

	for (const cell_key of level.playable_cells) {
		const cell = parse_cell_key(cell_key);
		occupancy[get_cell_index(
			level.size,
			cell.row,
			cell.column
		)] = empty_cell;
	}

	for (let piece_index = 0; piece_index < level.pieces.length; piece_index += 1) {
		const piece = level.pieces[piece_index];
		positions[piece_index * 2] = piece.row;
		positions[(piece_index * 2) + 1] = piece.column;

		for (const cell of get_piece_cells(piece)) {
			occupancy[get_cell_index(
				level.size,
				cell.row,
				cell.column
			)] = piece_index;
		}
	}

	let empty_index = -1;

	for (let cell_index = 0; cell_index < occupancy.length; cell_index += 1) {
		if (occupancy[cell_index] === empty_cell) {
			empty_index = cell_index;
			break;
		}
	}

	if (empty_index === -1) {
		throw new Error("The generated state has no empty cell.");
	}

	return { positions, occupancy, empty_index };
}

function clone_search_state(state) {
	return {
		positions: new Int16Array(state.positions),
		occupancy: new Int16Array(state.occupancy),
		empty_index: state.empty_index
	};
}

function get_state_hash(state) {
	return `${state.empty_index}|${Array.from(state.positions).join(",")}`;
}

function get_piece_cells_from_state(level, state, piece_index) {
	const piece = level.pieces[piece_index];
	const row = state.positions[piece_index * 2];
	const column = state.positions[(piece_index * 2) + 1];
	return get_piece_cells(piece, row, column);
}

function can_apply_state_move(level, state, piece_index, direction_name) {
	const direction = directions[direction_name];
	const piece = level.pieces[piece_index];

	if (!direction || !piece) {
		return false;
	}

	const row = state.positions[piece_index * 2];
	const column = state.positions[(piece_index * 2) + 1];
	let uses_empty = false;

	for (const cell of get_piece_cells(
		piece,
		row + direction.row,
		column + direction.column
	)) {
		if (!is_inside_board(level.size, cell.row, cell.column)) {
			return false;
		}

		const cell_index = get_cell_index(
			level.size,
			cell.row,
			cell.column
		);
		const occupant = state.occupancy[cell_index];

		if (occupant === blocked_cell) {
			return false;
		}

		if (occupant === empty_cell) {
			uses_empty = true;
			continue;
		}

		if (occupant !== piece_index) {
			return false;
		}
	}

	return uses_empty;
}

function apply_state_move(level, state, move) {
	if (!can_apply_state_move(
		level,
		state,
		move.piece_index,
		move.direction
	)) {
		return null;
	}

	const next_state = clone_search_state(state);
	const piece = level.pieces[move.piece_index];
	const previous_cells = get_piece_cells_from_state(
		level,
		next_state,
		move.piece_index
	);
	const direction = directions[move.direction];

	for (const cell of previous_cells) {
		next_state.occupancy[get_cell_index(
			level.size,
			cell.row,
			cell.column
		)] = empty_cell;
	}

	next_state.positions[move.piece_index * 2] += direction.row;
	next_state.positions[(move.piece_index * 2) + 1] += direction.column;

	for (const cell of get_piece_cells_from_state(
		level,
		next_state,
		move.piece_index
	)) {
		next_state.occupancy[get_cell_index(
			level.size,
			cell.row,
			cell.column
		)] = move.piece_index;
	}

	for (const cell of previous_cells) {
		const cell_index = get_cell_index(
			level.size,
			cell.row,
			cell.column
		);

		if (next_state.occupancy[cell_index] === empty_cell) {
			next_state.empty_index = cell_index;
			break;
		}
	}

	return next_state;
}

function get_legal_state_moves(level, state, excluded_piece_index = -1) {
	const empty_row = get_row_from_index(level.size, state.empty_index);
	const empty_column = get_column_from_index(level.size, state.empty_index);
	const candidate_piece_indexes = new Set();
	const legal_moves = [];

	for (const neighbor of get_neighbor_cells(
		level.size,
		empty_row,
		empty_column
	)) {
		const piece_index = state.occupancy[get_cell_index(
			level.size,
			neighbor.row,
			neighbor.column
		)];

		if (
			piece_index >= 0 &&
			piece_index !== excluded_piece_index
		) {
			candidate_piece_indexes.add(piece_index);
		}
	}

	for (const piece_index of candidate_piece_indexes) {
		for (const direction_name of Object.keys(directions)) {
			if (can_apply_state_move(
				level,
				state,
				piece_index,
				direction_name
			)) {
				legal_moves.push({
					piece_index,
					piece_id: level.pieces[piece_index].id,
					direction: direction_name
				});
			}
		}
	}

	return legal_moves;
}

function get_long_piece_ids_from_moves(level, moves) {
	const long_piece_ids = new Set();

	for (const move of moves) {
		const piece = level.pieces[move.piece_index];

		if (piece.width === 2 || piece.height === 2) {
			long_piece_ids.add(piece.id);
		}
	}

	return long_piece_ids;
}

function find_shortest_support_plan(
	level,
	start_state,
	destination_index,
	target_piece_index,
	maximum_depth,
	maximum_expanded
) {
	const queue = [{
		state: start_state,
		moves: []
	}];
	const visited = new Set([get_state_hash(start_state)]);
	const goal_nodes = [];
	let read_index = 0;
	let found_depth = -1;
	let expanded = 0;

	while (read_index < queue.length && expanded < maximum_expanded) {
		const node = queue[read_index];
		read_index += 1;
		expanded += 1;
		const depth = node.moves.length;

		if (found_depth !== -1 && depth > found_depth) {
			break;
		}

		if (node.state.empty_index === destination_index) {
			found_depth = depth;
			goal_nodes.push(node);
			continue;
		}

		if (depth >= maximum_depth) {
			continue;
		}

		for (const move of get_legal_state_moves(
			level,
			node.state,
			target_piece_index
		)) {
			const next_state = apply_state_move(level, node.state, move);

			if (!next_state) {
				continue;
			}

			const state_hash = get_state_hash(next_state);

			if (visited.has(state_hash)) {
				continue;
			}

			visited.add(state_hash);
			queue.push({
				state: next_state,
				moves: node.moves.concat(move)
			});
		}
	}

	if (goal_nodes.length === 0) {
		return null;
	}

	goal_nodes.sort((first, second) => {
		const first_long_count = get_long_piece_ids_from_moves(
			level,
			first.moves
		).size;
		const second_long_count = get_long_piece_ids_from_moves(
			level,
			second.moves
		).size;

		return second_long_count - first_long_count;
	});

	return goal_nodes[0];
}

function get_target_position(level, state, target_piece_index) {
	return {
		row: state.positions[target_piece_index * 2],
		column: state.positions[(target_piece_index * 2) + 1]
	};
}

function get_direction_between_cells(from_cell, to_cell) {
	const row_difference = to_cell.row - from_cell.row;
	const column_difference = to_cell.column - from_cell.column;

	for (const [direction_name, direction] of Object.entries(directions)) {
		if (
			direction.row === row_difference &&
			direction.column === column_difference
		) {
			return direction_name;
		}
	}

	return null;
}

function get_manhattan_distance(first, second) {
	return (
		Math.abs(first.row - second.row) +
		Math.abs(first.column - second.column)
	);
}

function plan_focused_scramble(level, random) {
	const target_piece_index = level.pieces.findIndex(
		(piece) => piece.id === target_piece_id
	);
	let state = create_search_state(level);
	const initial_target_position = get_target_position(
		level,
		state,
		target_piece_index
	);
	const initial_empty_position = {
		row: get_row_from_index(level.size, state.empty_index),
		column: get_column_from_index(level.size, state.empty_index)
	};
	const initial_direction = get_direction_between_cells(
		initial_target_position,
		initial_empty_position
	);

	if (!initial_direction) {
		throw new Error("The initial empty cell is not beside the target.");
	}

	const initial_target_move = {
		piece_index: target_piece_index,
		piece_id: target_piece_id,
		direction: initial_direction
	};
	const initial_state = apply_state_move(
		level,
		state,
		initial_target_move
	);

	if (!initial_state) {
		throw new Error("The target could not make its initial focused move.");
	}

	state = initial_state;
	const scramble_moves = [{
		piece_id: target_piece_id,
		direction: initial_direction
	}];
	const target_path = [
		initial_target_position,
		initial_empty_position
	];
	const visited_target_cells = new Set([
		get_cell_key(
			initial_target_position.row,
			initial_target_position.column
		),
		get_cell_key(
			initial_empty_position.row,
			initial_empty_position.column
		)
	]);
	const moved_long_piece_ids = new Set();
	let previous_target_direction = initial_direction;
	let current_run_length = 1;
	let desired_run_length = 2 + Math.floor(random() * 2);
	let target_turn_count = 0;
	const desired_target_moves = Math.max(
		5,
		Math.min(12, level.size + 3)
	);
	const minimum_target_moves = level.size === 4
		? 3
		: level.size === 5
			? 4
			: Math.min(9, Math.max(6, Math.floor(level.size * 0.75)));
	const minimum_turn_count = level.size <= 5
		? 2
		: Math.min(5, Math.max(3, Math.floor(level.size / 4)));
	const minimum_moved_domino_count = level.size <= 5
		? 1
		: Math.min(6, Math.max(2, Math.floor(level.size / 3)));

	for (
		let target_step = 1;
		target_step < desired_target_moves;
		target_step += 1
	) {
		const target_position = get_target_position(
			level,
			state,
			target_piece_index
		);
		const current_distance = get_manhattan_distance(
			target_position,
			level.goal
		);
		const candidates = [];

		for (const [direction_name, direction] of Object.entries(directions)) {
			if (
				previous_target_direction &&
				direction_name ===
					opposite_directions[previous_target_direction]
			) {
				continue;
			}

			const destination = {
				row: target_position.row + direction.row,
				column: target_position.column + direction.column
			};
			const destination_key = get_cell_key(
				destination.row,
				destination.column
			);

			if (
				!level.playable_cells.has(destination_key) ||
				visited_target_cells.has(destination_key)
			) {
				continue;
			}

			const destination_index = get_cell_index(
				level.size,
				destination.row,
				destination.column
			);
			const support_plan = find_shortest_support_plan(
				level,
				state,
				destination_index,
				target_piece_index,
				Math.min(20, 10 + Math.floor(level.size / 2)),
				9000
			);

			if (!support_plan) {
				continue;
			}

			const target_move = {
				piece_index: target_piece_index,
				piece_id: target_piece_id,
				direction: direction_name
			};
			const state_after_target = apply_state_move(
				level,
				support_plan.state,
				target_move
			);

			if (!state_after_target) {
				continue;
			}

			const support_long_ids = get_long_piece_ids_from_moves(
				level,
				support_plan.moves
			);
			let new_long_count = 0;

			for (const piece_id of support_long_ids) {
				if (!moved_long_piece_ids.has(piece_id)) {
					new_long_count += 1;
				}
			}

			const next_distance = get_manhattan_distance(
				destination,
				level.goal
			);
			const is_turn =
				previous_target_direction !== null &&
				direction_name !== previous_target_direction;
			const wants_turn = current_run_length >= desired_run_length;
			let score = 0;

			score += next_distance * 9;
			score += new_long_count * 80;
			score += support_long_ids.size * 20;
			score -= support_plan.moves.length * 1.4;
			score += next_distance >= current_distance ? 10 : -8;
			score += wants_turn
				? is_turn ? 34 : -18
				: is_turn ? -5 : 14;
			score += random() * 6;

			candidates.push({
				direction_name,
				destination,
				destination_key,
				support_plan,
				state_after_target,
				support_long_ids,
				is_turn,
				score
			});
		}

		if (candidates.length === 0) {
			break;
		}

		candidates.sort((first, second) => second.score - first.score);
		const selected = candidates[0];

		for (const move of selected.support_plan.moves) {
			scramble_moves.push({
				piece_id: move.piece_id,
				direction: move.direction
			});
		}

		scramble_moves.push({
			piece_id: target_piece_id,
			direction: selected.direction_name
		});

		for (const piece_id of selected.support_long_ids) {
			moved_long_piece_ids.add(piece_id);
		}

		if (selected.is_turn) {
			target_turn_count += 1;
			current_run_length = 1;
			desired_run_length = 2 + Math.floor(random() * 3);
		} else {
			current_run_length += 1;
		}

		previous_target_direction = selected.direction_name;
		visited_target_cells.add(selected.destination_key);
		target_path.push({ ...selected.destination });
		state = selected.state_after_target;
	}

	if (
		target_path.length - 1 < minimum_target_moves ||
		target_turn_count < minimum_turn_count ||
		moved_long_piece_ids.size < minimum_moved_domino_count
	) {
		throw new Error("The planned solution was not complex enough.");
	}

	for (let piece_index = 0; piece_index < level.pieces.length; piece_index += 1) {
		level.pieces[piece_index].row = state.positions[piece_index * 2];
		level.pieces[piece_index].column =
			state.positions[(piece_index * 2) + 1];
	}

	level.scramble_moves = scramble_moves;
	level.solution_moves = scramble_moves
		.slice()
		.reverse()
		.map(get_inverse_move);
	level.target_path = target_path;
	level.target_turn_count = target_turn_count;
	level.minimum_turn_count = minimum_turn_count;
	level.moved_domino_count = moved_long_piece_ids.size;
	level.minimum_moved_domino_count = minimum_moved_domino_count;
	level.moved_domino_ids = Array.from(moved_long_piece_ids);
}

function get_occupancy_map(level) {
	const occupancy = new Map();

	for (const piece of level.pieces) {
		for (const cell of get_piece_cells(piece)) {
			occupancy.set(
				get_cell_key(cell.row, cell.column),
				piece.id
			);
		}
	}

	return occupancy;
}

function find_empty_cell(level, occupancy = get_occupancy_map(level)) {
	for (const cell_key of level.playable_cells) {
		if (!occupancy.has(cell_key)) {
			return parse_cell_key(cell_key);
		}
	}

	return null;
}

function can_move_piece(
	level,
	piece,
	direction_name,
	occupancy = get_occupancy_map(level)
) {
	const direction = directions[direction_name];

	if (!piece || !direction) {
		return false;
	}

	let uses_empty = false;

	for (const cell of get_piece_cells(
		piece,
		piece.row + direction.row,
		piece.column + direction.column
	)) {
		const cell_key = get_cell_key(cell.row, cell.column);
		const occupying_piece_id = occupancy.get(cell_key);

		if (!level.playable_cells.has(cell_key)) {
			return false;
		}

		if (occupying_piece_id === undefined) {
			uses_empty = true;
			continue;
		}

		if (occupying_piece_id !== piece.id) {
			return false;
		}
	}

	return uses_empty;
}

function apply_move(
	level,
	move,
	occupancy = get_occupancy_map(level)
) {
	const piece = level.pieces.find(
		(candidate_piece) => candidate_piece.id === move.piece_id
	);

	if (!piece || !can_move_piece(
		level,
		piece,
		move.direction,
		occupancy
	)) {
		return false;
	}

	const previous_cells = get_piece_cells(piece);
	const direction = directions[move.direction];

	for (const cell of previous_cells) {
		occupancy.delete(get_cell_key(cell.row, cell.column));
	}

	piece.row += direction.row;
	piece.column += direction.column;

	for (const cell of get_piece_cells(piece)) {
		occupancy.set(
			get_cell_key(cell.row, cell.column),
			piece.id
		);
	}

	return true;
}

function target_is_on_goal(level) {
	const target_piece = level.pieces.find(
		(piece) => piece.id === target_piece_id
	);

	return (
		target_piece.row === level.goal.row &&
		target_piece.column === level.goal.column
	);
}

function count_empty_cells(level) {
	const occupancy = get_occupancy_map(level);
	let empty_count = 0;

	for (const cell_key of level.playable_cells) {
		if (!occupancy.has(cell_key)) {
			empty_count += 1;
		}
	}

	return empty_count;
}

function validate_level_structure(level) {
	const occupied = new Set();
	let target_count = 0;
	let domino_count = 0;

	for (const piece of level.pieces) {
		if (piece.target) {
			target_count += 1;
		}

		if (piece.width === 2 || piece.height === 2) {
			domino_count += 1;
		}

		for (const cell of get_piece_cells(piece)) {
			const cell_key = get_cell_key(cell.row, cell.column);

			if (
				!level.playable_cells.has(cell_key) ||
				occupied.has(cell_key)
			) {
				return false;
			}

			occupied.add(cell_key);
		}
	}

	return (
		target_count === 1 &&
		domino_count === level.domino_count &&
		level.domino_cell_ratio >=
			(level.size === 4 ? 0.34 : 0.42) &&
		level.target_turn_count >= level.minimum_turn_count &&
		level.moved_domino_count >=
			level.minimum_moved_domino_count &&
		count_empty_cells(level) === 1 &&
		!target_is_on_goal(level) &&
		level.solution_moves.length > 0
	);
}

function replay_solution(level) {
	const replay_level = {
		size: level.size,
		playable_cells: new Set(level.playable_cells),
		void_cells: new Set(level.void_cells),
		wall_cells: new Set(level.wall_cells),
		goal: { ...level.goal },
		solved_empty: { ...level.solved_empty },
		pieces: level.pieces.map(clone_piece)
	};
	const replay_occupancy = get_occupancy_map(replay_level);

	for (const move of level.solution_moves) {
		if (!apply_move(replay_level, move, replay_occupancy)) {
			return false;
		}
	}

	return (
		target_is_on_goal(replay_level) &&
		count_empty_cells(replay_level) === 1
	);
}

function create_level(size, seed) {
	for (
		let attempt = 0;
		attempt < generation_attempt_limit;
		attempt += 1
	) {
		const attempt_seed = (seed + (attempt * 104729)) >>> 0;
		const random = make_seeded_random(attempt_seed);

		try {
			const shape = create_shape(size, random);
			const goal_data = choose_goal_and_empty(shape, random);
			const piece_layout = create_piece_layout(
				shape,
				goal_data,
				random
			);
			const level = {
				size,
				seed: attempt_seed,
				playable_cells: shape.playable_cells,
				void_cells: shape.void_cells,
				wall_cells: shape.wall_cells,
				goal: goal_data.goal,
				solved_empty: goal_data.solved_empty,
				pieces: piece_layout.pieces,
				domino_count: piece_layout.domino_count,
				domino_cell_ratio: piece_layout.domino_cell_ratio,
				scramble_moves: [],
				solution_moves: [],
				target_path: [],
				target_turn_count: 0,
				minimum_turn_count: 0,
				moved_domino_count: 0,
				minimum_moved_domino_count: 0,
				moved_domino_ids: []
			};

			plan_focused_scramble(level, random);

			if (
				validate_level_structure(level) &&
				replay_solution(level)
			) {
				return level;
			}
		} catch (error) {
			continue;
		}
	}

	throw new Error(
		`Unable to create a valid ${size} × ${size} map.`
	);
}

function create_cell_element(row, column, empty_key) {
	const cell_key = get_cell_key(row, column);
	const cell_element = document.createElement("div");

	cell_element.className = "cell";
	cell_element.style.gridRow = String(row + 1);
	cell_element.style.gridColumn = String(column + 1);
	cell_element.dataset.row = String(row);
	cell_element.dataset.column = String(column);

	if (level_data.void_cells.has(cell_key)) {
		cell_element.classList.add("void_cell");
		cell_element.setAttribute("aria-hidden", "true");
		return cell_element;
	}

	if (level_data.wall_cells.has(cell_key)) {
		cell_element.classList.add("wall_cell");
		cell_element.setAttribute("aria-label", "Blocked wall");
		return cell_element;
	}

	cell_element.classList.add("floor_cell");

	if (cell_key === empty_key) {
		cell_element.classList.add("empty_cell");
		cell_element.setAttribute("aria-label", "Empty space");
	}

	if (
		row === level_data.goal.row &&
		column === level_data.goal.column
	) {
		cell_element.classList.add("goal_cell");
		cell_element.setAttribute("aria-label", "Goal");
	}

	return cell_element;
}

function create_goal_overlay_element() {
	const goal_overlay = document.createElement("div");

	goal_overlay.className = "goal_overlay";
	goal_overlay.style.gridRow = String(level_data.goal.row + 1);
	goal_overlay.style.gridColumn = String(level_data.goal.column + 1);
	goal_overlay.setAttribute("aria-hidden", "true");

	return goal_overlay;
}

function create_piece_element(piece) {
	const piece_element = document.createElement("button");

	piece_element.type = "button";
	piece_element.className = "block";
	piece_element.draggable = false;
	piece_element.dataset.pieceId = piece.id;
	piece_element.dataset.long =
		piece.width === 2 || piece.height === 2
			? "true"
			: "false";
	piece_element.style.gridRow =
		`${piece.row + 1} / span ${piece.height}`;
	piece_element.style.gridColumn =
		`${piece.column + 1} / span ${piece.width}`;
	piece_element.setAttribute(
		"aria-label",
		piece.target
			? "Orange target block"
			: piece.width === 2 || piece.height === 2
				? "Long sliding block"
				: "Sliding block"
	);

	if (piece.target) {
		piece_element.classList.add("target_block");
	} else {
		piece_element.classList.add(`color_${piece.color}`);
	}

	if (piece.id === selected_piece_id) {
		piece_element.classList.add("selected");
	}

	if (piece.id === hint_piece_id) {
		const next_move = get_next_solution_move();
		piece_element.classList.add("hint");
		piece_element.dataset.hintArrow = get_hint_arrow(
			next_move ? next_move.direction : ""
		);
	}

	return piece_element;
}

function update_game_information() {
	document.documentElement.style.setProperty(
		"--grid_size",
		String(board_size)
	);

	level_number_element.textContent = String(level_number);
	board_size_text_element.textContent =
		`${board_size} × ${board_size}`;
	move_count_element.textContent = String(move_count);

	if (flow_count_element) {
		flow_count_element.textContent = `×${combo_count}`;
	}

	board_element.setAttribute(
		"aria-label",
		`${board_size} by ${board_size} solvable sliding block board`
	);
	update_juice_dashboard();
}

function update_direction_buttons() {
	const selected_piece = level_data
		? level_data.pieces.find(
			(piece) => piece.id === selected_piece_id
		)
		: null;

	for (const button of direction_buttons) {
		button.disabled =
			game_won ||
			auto_solving ||
			!selected_piece ||
			!can_move_piece(
				level_data,
				selected_piece,
				button.dataset.direction
			);
	}
}

function render_board() {
	const fragment = document.createDocumentFragment();
	const current_empty_cell = find_empty_cell(level_data);
	const empty_key = current_empty_cell
		? get_cell_key(
			current_empty_cell.row,
			current_empty_cell.column
		)
		: "";

	for (let row = 0; row < board_size; row += 1) {
		for (let column = 0; column < board_size; column += 1) {
			fragment.appendChild(
				create_cell_element(row, column, empty_key)
			);
		}
	}

	for (const piece of level_data.pieces) {
		fragment.appendChild(create_piece_element(piece));
	}

	fragment.appendChild(create_goal_overlay_element());
	board_element.replaceChildren(fragment);
	update_game_information();
	update_direction_buttons();
}

function move_piece_by_id(piece_id, direction_name, input_intensity = 1) {
	if (game_won || auto_solving || !piece_id) {
		return false;
	}

	const move = {
		piece_id,
		direction: direction_name
	};
	const moving_piece = level_data.pieces.find(
		(piece) => piece.id === piece_id
	);

	if (!moving_piece) {
		return false;
	}

	const before_rect = get_piece_rect(piece_id);
	const empty_rect_before = board_element
		.querySelector(".empty_cell")
		?.getBoundingClientRect();
	const target_distance_before = get_target_distance(level_data);

	if (!apply_move(level_data, move)) {
		status_message_element.textContent =
			"That block cannot move in that direction.";
		trigger_invalid_feedback(direction_name, before_rect);
		schedule_hint();
		return false;
	}

	record_player_move(move);
	move_count += 1;
	hint_piece_id = null;
	selected_piece_id = null;
	render_board();
	trigger_move_feedback(
		move,
		moving_piece,
		before_rect,
		target_distance_before,
		false,
		input_intensity,
		empty_rect_before
	);
	check_for_win();

	if (!game_won) {
		status_message_element.textContent =
			"Flick another block toward the empty space.";
		schedule_hint();
	}

	return true;
}

function check_for_win() {
	if (!target_is_on_goal(level_data)) {
		status_message_element.textContent =
			"Keep moving the orange block toward the goal.";
		return;
	}

	game_won = true;
	clear_hint();
	finish_auto_solve();
	selected_piece_id = null;
	status_message_element.textContent =
		`Level complete in ${move_count} moves. Loading a larger map...`;
	status_message_element.classList.add("win");
	update_direction_buttons();
	trigger_win_feedback();

	level_change_timer = window.setTimeout(() => {
		board_size += 1;
		level_number += 1;
		start_level();
	}, level_change_delay);
}

function get_flick_direction(horizontal_distance, vertical_distance) {
	if (Math.abs(horizontal_distance) >= Math.abs(vertical_distance)) {
		return horizontal_distance >= 0 ? "right" : "left";
	}

	return vertical_distance >= 0 ? "down" : "up";
}

function clear_pointer_preview(pointer_data) {
	if (!pointer_data || !pointer_data.element) {
		return;
	}

	pointer_data.element.classList.remove("flicking", "flick_charged");
	pointer_data.element.style.removeProperty("transform");
	pointer_data.element.style.removeProperty("--flick-charge");
}

function handle_keyboard_input(event) {
	if (auto_solving) {
		event.preventDefault();
		return;
	}

	const code_result = process_secret_code_key(event.key);

	if (code_result.matched) {
		event.preventDefault();
		start_auto_solve();
		return;
	}

	if (code_result.captured) {
		event.preventDefault();
		return;
	}

	const key_directions = {
		ArrowUp: "up",
		ArrowDown: "down",
		ArrowLeft: "left",
		ArrowRight: "right",
		w: "up",
		W: "up",
		s: "down",
		S: "down",
		a: "left",
		A: "left",
		d: "right",
		D: "right"
	};
	const direction_name = key_directions[event.key];

	if (!direction_name) {
		return;
	}

	const focused_piece = document.activeElement
		? document.activeElement.closest(".block")
		: null;

	if (!focused_piece || !board_element.contains(focused_piece)) {
		return;
	}

	event.preventDefault();
	move_piece_by_id(
		focused_piece.dataset.pieceId,
		direction_name
	);
}

function handle_pointer_down(event) {
	const piece_element = event.target.closest(".block");

	if (
		!piece_element ||
		auto_solving ||
		game_won ||
		event.button !== 0
	) {
		pointer_start = null;
		return;
	}

	event.preventDefault();
	ensure_audio_context();
	clear_hint();
	piece_element.classList.add("flicking");

	if (piece_element.setPointerCapture) {
		piece_element.setPointerCapture(event.pointerId);
	}

	pointer_start = {
		x: event.clientX,
		y: event.clientY,
		last_x: event.clientX,
		last_y: event.clientY,
		started_at: performance.now(),
		pointer_id: event.pointerId,
		piece_id: piece_element.dataset.pieceId,
		element: piece_element
	};
}

function handle_pointer_move(event) {
	if (
		!pointer_start ||
		auto_solving ||
		event.pointerId !== pointer_start.pointer_id
	) {
		return;
	}

	event.preventDefault();
	pointer_start.last_x = event.clientX;
	pointer_start.last_y = event.clientY;

	const horizontal_distance = event.clientX - pointer_start.x;
	const vertical_distance = event.clientY - pointer_start.y;
	const direction_name = get_flick_direction(
		horizontal_distance,
		vertical_distance
	);
	const piece = level_data.pieces.find(
		(candidate_piece) =>
			candidate_piece.id === pointer_start.piece_id
	);
	const legal = can_move_piece(
		level_data,
		piece,
		direction_name
	);
	const resistance = legal ? 1 : flick_invalid_resistance;
	let preview_x = 0;
	let preview_y = 0;

	if (Math.abs(horizontal_distance) >= Math.abs(vertical_distance)) {
		preview_x = Math.max(
			-flick_preview_limit,
			Math.min(
				flick_preview_limit,
				horizontal_distance * resistance
			)
		);
	} else {
		preview_y = Math.max(
			-flick_preview_limit,
			Math.min(
				flick_preview_limit,
				vertical_distance * resistance
			)
		);
	}

	const dominant_distance = Math.max(
		Math.abs(horizontal_distance),
		Math.abs(vertical_distance)
	);
	const charge = clamp(dominant_distance / (flick_distance_threshold * 2.25), 0, 1);
	pointer_start.element.style.setProperty("--flick-charge", String(charge));
	pointer_start.element.classList.toggle("flick_charged", legal && charge >= 0.58);
	pointer_start.element.style.transform =
		`translate(${preview_x}px, ${preview_y}px) scale(${1.03 + charge * 0.045})`;
}

function finish_pointer_flick(event, cancelled = false) {
	if (
		!pointer_start ||
		event.pointerId !== pointer_start.pointer_id
	) {
		return;
	}

	const pointer_data = pointer_start;
	pointer_start = null;

	if (
		pointer_data.element.releasePointerCapture &&
		pointer_data.element.hasPointerCapture &&
		pointer_data.element.hasPointerCapture(event.pointerId)
	) {
		pointer_data.element.releasePointerCapture(event.pointerId);
	}

	clear_pointer_preview(pointer_data);

	if (cancelled || auto_solving || game_won) {
		schedule_hint();
		return;
	}

	const horizontal_distance = event.clientX - pointer_data.x;
	const vertical_distance = event.clientY - pointer_data.y;
	const dominant_distance = Math.max(
		Math.abs(horizontal_distance),
		Math.abs(vertical_distance)
	);
	const elapsed = Math.max(1, performance.now() - pointer_data.started_at);
	const velocity = dominant_distance / elapsed;

	if (
		dominant_distance < flick_distance_threshold &&
		velocity < flick_velocity_threshold
	) {
		status_message_element.textContent =
			"Flick a block toward the empty space.";
		schedule_hint();
		return;
	}

	const direction_name = get_flick_direction(
		horizontal_distance,
		vertical_distance
	);
	const flick_intensity = clamp(
		0.72 + (velocity * 1.25) + (dominant_distance / 210),
		0.8,
		2.2
	);
	move_piece_by_id(
		pointer_data.piece_id,
		direction_name,
		flick_intensity
	);
}

function handle_pointer_up(event) {
	finish_pointer_flick(event, false);
}

function handle_pointer_cancel(event) {
	finish_pointer_flick(event, true);
}

function start_level() {
	clear_hint();
	clear_auto_solve_timer();
	auto_solving = false;
	typed_code_buffer = "";
	restart_button.disabled = false;

	if (level_change_timer !== null) {
		window.clearTimeout(level_change_timer);
		level_change_timer = null;
	}

	generation_number += 1;
	move_count = 0;
	selected_piece_id = null;
	game_won = false;
	reset_flow();

	try {
		const seed = (
			Date.now() +
			(level_number * 65537) +
			(generation_number * 31337)
		) >>> 0;

		level_data = create_level(board_size, seed);
		solution_path = level_data.scramble_moves.map(clone_move);
		hint_piece_id = null;
		status_message_element.textContent =
			`Level ${level_number}: flick blocks directly toward the empty space.`;
		status_message_element.classList.remove("win", "error");
		render_board();
		animate_board_intro();
		show_level_banner("LEVEL", String(level_number));
		const goal_rect = board_element
			.querySelector(".goal_overlay")
			?.getBoundingClientRect();
		create_starburst(goal_rect, "#86efac", 1.25);
		show_toast(
			`${level_data.moved_domino_count} long blocks are required`
		);
		window.setTimeout(() => show_toast("Chain quick flicks for stronger feedback"), 520);
		pulse_status();
		schedule_hint();
	} catch (error) {
		status_message_element.textContent =
			"Map generation failed safely. Press New Map to retry.";
		status_message_element.classList.remove("win");
		status_message_element.classList.add("error");
	}
}

function initialize_game() {
	game_element = document.querySelector(".game");
	board_element = document.getElementById("board");
	board_frame_element = document.getElementById("board_frame");
	effects_layer_element = document.getElementById("effects_layer");
	optimized_effect_canvas = document.getElementById("effects_canvas");
	ensure_effect_canvas();
	level_number_element = document.getElementById("level_number");
	board_size_text_element =
		document.getElementById("board_size_text");
	move_count_element = document.getElementById("move_count");
	flow_count_element = document.getElementById("flow_count");
	flow_rank_element = document.getElementById("flow_rank");
	momentum_fill_element = document.getElementById("momentum_fill");
	proximity_text_element = document.getElementById("proximity_text");
	proximity_fill_element = document.getElementById("proximity_fill");
	status_message_element =
		document.getElementById("status_message");
	restart_button = document.getElementById("restart_button");
	sound_button = document.getElementById("sound_button");
	level_banner_element = document.getElementById("level_banner");
	level_banner_kicker_element = document.getElementById(
		"level_banner_kicker"
	);
	level_banner_text_element = document.getElementById(
		"level_banner_text"
	);
	toast_layer_element = document.getElementById("toast_layer");
	direction_buttons = [];

	restart_button.addEventListener("click", () => {
		ensure_audio_context();
		play_tone({
			frequency: 260,
			frequency_end: 430,
			duration: 0.12,
			volume: 0.035,
			type: "triangle"
		});
		start_level();
	});
	sound_button.addEventListener("click", () => {
		set_sound_enabled(!sound_enabled);
	});
	board_element.addEventListener(
		"pointerdown",
		handle_pointer_down
	);
	board_element.addEventListener(
		"pointermove",
		handle_pointer_move
	);
	board_element.addEventListener(
		"pointerup",
		handle_pointer_up
	);
	board_element.addEventListener(
		"pointercancel",
		handle_pointer_cancel
	);
	document.addEventListener("keydown", handle_keyboard_input);
	window.addEventListener("resize", ensure_effect_canvas, { passive: true });


	document.addEventListener(
		"pointerdown",
		ensure_audio_context,
		{ once: true }
	);
	sound_button.setAttribute("aria-pressed", "true");
	sound_button.setAttribute("aria-label", "Turn sound off");
	sound_button.textContent = "Sound On";
	start_level();
}




/* Bounded, goal-directed scramble planner */
function get_state_move_empty_index(level, state, move) {
	const piece = level.pieces[move.piece_index];
	const direction = directions[move.direction];
	const old_row = state.positions[move.piece_index * 2];
	const old_column = state.positions[(move.piece_index * 2) + 1];
	const new_row = old_row + direction.row;
	const new_column = old_column + direction.column;

	for (let row_offset = 0; row_offset < piece.height; row_offset += 1) {
		for (let column_offset = 0; column_offset < piece.width; column_offset += 1) {
			const row = old_row + row_offset;
			const column = old_column + column_offset;
			const remains_covered =
				row >= new_row &&
				row < new_row + piece.height &&
				column >= new_column &&
				column < new_column + piece.width;

			if (!remains_covered) {
				return get_cell_index(level.size, row, column);
			}
		}
	}

	return state.empty_index;
}

function apply_state_move_mutable(level, state, move) {
	if (!can_apply_state_move(level, state, move.piece_index, move.direction)) {
		return false;
	}

	const piece = level.pieces[move.piece_index];
	const old_row = state.positions[move.piece_index * 2];
	const old_column = state.positions[(move.piece_index * 2) + 1];
	const direction = directions[move.direction];
	const next_empty_index = get_state_move_empty_index(level, state, move);

	for (let row_offset = 0; row_offset < piece.height; row_offset += 1) {
		for (let column_offset = 0; column_offset < piece.width; column_offset += 1) {
			state.occupancy[get_cell_index(
				level.size,
				old_row + row_offset,
				old_column + column_offset
			)] = empty_cell;
		}
	}

	const new_row = old_row + direction.row;
	const new_column = old_column + direction.column;
	state.positions[move.piece_index * 2] = new_row;
	state.positions[(move.piece_index * 2) + 1] = new_column;

	for (let row_offset = 0; row_offset < piece.height; row_offset += 1) {
		for (let column_offset = 0; column_offset < piece.width; column_offset += 1) {
			state.occupancy[get_cell_index(
				level.size,
				new_row + row_offset,
				new_column + column_offset
			)] = move.piece_index;
		}
	}

	state.empty_index = next_empty_index;
	return true;
}

function get_index_distance(size, first_index, second_index) {
	return (
		Math.abs(get_row_from_index(size, first_index) - get_row_from_index(size, second_index)) +
		Math.abs(get_column_from_index(size, first_index) - get_column_from_index(size, second_index))
	);
}

function find_bounded_support_plan(
	level,
	start_state,
	destination_index,
	target_piece_index,
	random,
	already_moved_long_ids
) {
	const state = clone_search_state(start_state);
	const moves = [];
	const visited_empty_counts = new Uint8Array(level.size * level.size);
	visited_empty_counts[state.empty_index] = 1;
	let previous_move = null;
	const maximum_steps = Math.min(96, Math.max(24, level.size * 6));

	for (let step = 0; step < maximum_steps; step += 1) {
		if (state.empty_index === destination_index) {
			return { state, moves };
		}

		const current_distance = get_index_distance(
			level.size,
			state.empty_index,
			destination_index
		);
		const legal_moves = get_legal_state_moves(
			level,
			state,
			target_piece_index
		);

		if (legal_moves.length === 0) {
			return null;
		}

		let selected_move = null;
		let selected_score = -Infinity;

		for (const move of legal_moves) {
			const next_empty_index = get_state_move_empty_index(level, state, move);
			const next_distance = get_index_distance(
				level.size,
				next_empty_index,
				destination_index
			);
			const piece = level.pieces[move.piece_index];
			const is_long = piece.width === 2 || piece.height === 2;
			const is_new_long = is_long && !already_moved_long_ids.has(piece.id);
			const reverses_previous = previous_move &&
				previous_move.piece_index === move.piece_index &&
				move.direction === opposite_directions[previous_move.direction];
			let score = 0;

			score += (current_distance - next_distance) * 42;
			score -= next_distance * 3;
			score += is_new_long ? 24 : is_long ? 7 : 0;
			score -= visited_empty_counts[next_empty_index] * 18;
			score -= reverses_previous ? 34 : 0;
			score += random() * 5;

			if (score > selected_score) {
				selected_score = score;
				selected_move = move;
			}
		}

		if (!selected_move || !apply_state_move_mutable(level, state, selected_move)) {
			return null;
		}

		moves.push(selected_move);
		visited_empty_counts[state.empty_index] = Math.min(
			255,
			visited_empty_counts[state.empty_index] + 1
		);
		previous_move = selected_move;
	}

	return state.empty_index === destination_index
		? { state, moves }
		: null;
}

function plan_focused_scramble(level, random) {
	const target_piece_index = level.pieces.findIndex(
		(piece) => piece.id === target_piece_id
	);
	let state = create_search_state(level);
	const initial_target_position = get_target_position(level, state, target_piece_index);
	const initial_empty_position = {
		row: get_row_from_index(level.size, state.empty_index),
		column: get_column_from_index(level.size, state.empty_index)
	};
	const initial_direction = get_direction_between_cells(
		initial_target_position,
		initial_empty_position
	);

	if (!initial_direction) {
		throw new Error("The initial empty cell is not beside the target.");
	}

	const initial_target_move = {
		piece_index: target_piece_index,
		piece_id: target_piece_id,
		direction: initial_direction
	};

	if (!apply_state_move_mutable(level, state, initial_target_move)) {
		throw new Error("The target could not make its initial focused move.");
	}

	const scramble_moves = [{
		piece_id: target_piece_id,
		direction: initial_direction
	}];
	const target_path = [initial_target_position, initial_empty_position];
	const visited_target_cells = new Set(target_path.map(
		(cell) => get_cell_key(cell.row, cell.column)
	));
	const moved_long_piece_ids = new Set();
	let previous_target_direction = initial_direction;
	let current_run_length = 1;
	let desired_run_length = 2 + Math.floor(random() * 2);
	let target_turn_count = 0;
	const desired_target_moves = Math.max(5, Math.min(12, level.size + 3));
	const minimum_target_moves = level.size === 4
		? 3
		: level.size === 5
			? 4
			: Math.min(9, Math.max(6, Math.floor(level.size * 0.7)));
	const minimum_turn_count = level.size <= 5
		? 2
		: Math.min(5, Math.max(3, Math.floor(level.size / 4)));
	const minimum_moved_domino_count = level.size <= 5
		? 1
		: Math.min(6, Math.max(2, Math.floor(level.size / 3)));

	for (let target_step = 1; target_step < desired_target_moves; target_step += 1) {
		const target_position = get_target_position(level, state, target_piece_index);
		const current_distance = get_manhattan_distance(target_position, level.goal);
		const candidates = [];

		for (const [direction_name, direction] of Object.entries(directions)) {
			if (
				previous_target_direction &&
				direction_name === opposite_directions[previous_target_direction]
			) {
				continue;
			}

			const destination = {
				row: target_position.row + direction.row,
				column: target_position.column + direction.column
			};
			const destination_key = get_cell_key(destination.row, destination.column);

			if (
				!level.playable_cells.has(destination_key) ||
				visited_target_cells.has(destination_key)
			) {
				continue;
			}

			const destination_index = get_cell_index(
				level.size,
				destination.row,
				destination.column
			);
			const support_plan = find_bounded_support_plan(
				level,
				state,
				destination_index,
				target_piece_index,
				random,
				moved_long_piece_ids
			);

			if (!support_plan) {
				continue;
			}

			const target_move = {
				piece_index: target_piece_index,
				piece_id: target_piece_id,
				direction: direction_name
			};
			const state_after_target = clone_search_state(support_plan.state);

			if (!apply_state_move_mutable(level, state_after_target, target_move)) {
				continue;
			}

			const support_long_ids = get_long_piece_ids_from_moves(level, support_plan.moves);
			let new_long_count = 0;

			for (const piece_id of support_long_ids) {
				if (!moved_long_piece_ids.has(piece_id)) {
					new_long_count += 1;
				}
			}

			const next_distance = get_manhattan_distance(destination, level.goal);
			const is_turn = previous_target_direction !== direction_name;
			const wants_turn = current_run_length >= desired_run_length;
			let score = 0;
			score += next_distance * 9;
			score += new_long_count * 70;
			score += support_long_ids.size * 15;
			score -= support_plan.moves.length * 1.2;
			score += next_distance >= current_distance ? 10 : -7;
			score += wants_turn
				? is_turn ? 30 : -16
				: is_turn ? -4 : 12;
			score += random() * 5;

			candidates.push({
				direction_name,
				destination,
				destination_key,
				support_plan,
				state_after_target,
				support_long_ids,
				is_turn,
				score
			});
		}

		if (candidates.length === 0) {
			break;
		}

		candidates.sort((first, second) => second.score - first.score);
		const selected = candidates[0];

		for (const move of selected.support_plan.moves) {
			scramble_moves.push({ piece_id: move.piece_id, direction: move.direction });
		}

		scramble_moves.push({
			piece_id: target_piece_id,
			direction: selected.direction_name
		});

		for (const piece_id of selected.support_long_ids) {
			moved_long_piece_ids.add(piece_id);
		}

		if (selected.is_turn) {
			target_turn_count += 1;
			current_run_length = 1;
			desired_run_length = 2 + Math.floor(random() * 3);
		} else {
			current_run_length += 1;
		}

		previous_target_direction = selected.direction_name;
		visited_target_cells.add(selected.destination_key);
		target_path.push({ ...selected.destination });
		state = selected.state_after_target;
	}

	if (
		target_path.length - 1 < minimum_target_moves ||
		target_turn_count < minimum_turn_count ||
		moved_long_piece_ids.size < minimum_moved_domino_count
	) {
		throw new Error("The planned solution was not complex enough.");
	}

	for (let piece_index = 0; piece_index < level.pieces.length; piece_index += 1) {
		level.pieces[piece_index].row = state.positions[piece_index * 2];
		level.pieces[piece_index].column = state.positions[(piece_index * 2) + 1];
	}

	level.scramble_moves = scramble_moves;
	level.solution_moves = scramble_moves.slice().reverse().map(get_inverse_move);
	level.target_path = target_path;
	level.target_turn_count = target_turn_count;
	level.minimum_turn_count = minimum_turn_count;
	level.moved_domino_count = moved_long_piece_ids.size;
	level.minimum_moved_domino_count = minimum_moved_domino_count;
	level.moved_domino_ids = Array.from(moved_long_piece_ids);
}

/* Optimized runtime and rendering layer */
let optimized_effect_canvas = null;
let optimized_effect_context = null;
let optimized_effect_frame = null;
let optimized_effects = [];
let optimized_canvas_width = 0;
let optimized_canvas_height = 0;
let optimized_canvas_ratio = 1;
let optimized_pointer_frame = null;
let optimized_pending_pointer = null;

function get_runtime_piece(level, piece_id) {
	if (level && level.runtime && level.runtime.piece_by_id) {
		return level.runtime.piece_by_id.get(piece_id) || null;
	}

	return level
		? level.pieces.find((piece) => piece.id === piece_id) || null
		: null;
}

function prepare_runtime_level(level) {
	if (!level || level.runtime) {
		return;
	}

	const cell_count = level.size * level.size;
	const occupancy = new Int16Array(cell_count);
	occupancy.fill(blocked_cell);

	for (const cell_key of level.playable_cells) {
		const cell = parse_cell_key(cell_key);
		occupancy[(cell.row * level.size) + cell.column] = empty_cell;
	}

	const piece_by_id = new Map();

	level.pieces.forEach((piece, piece_index) => {
		piece.runtime_index = piece_index;
		piece_by_id.set(piece.id, piece);

		for (const cell of get_piece_cells(piece)) {
			occupancy[(cell.row * level.size) + cell.column] = piece_index;
		}
	});

	let empty_index = -1;

	for (let index = 0; index < occupancy.length; index += 1) {
		if (occupancy[index] === empty_cell) {
			empty_index = index;
			break;
		}
	}

	level.runtime = {
		occupancy,
		piece_by_id,
		empty_index,
		cell_elements: new Array(cell_count),
		piece_elements: new Map(),
		goal_element: null,
		dom_ready: false,
		last_empty_index: -1,
		last_hint_piece_id: null,
		last_selected_piece_id: null
	};
}

function find_empty_cell(level, occupancy = null) {
	if (!occupancy && level && level.runtime) {
		const index = level.runtime.empty_index;

		return index >= 0
			? {
				row: Math.floor(index / level.size),
				column: index % level.size
			}
			: null;
	}

	const resolved_occupancy = occupancy || get_occupancy_map(level);

	for (const cell_key of level.playable_cells) {
		if (!resolved_occupancy.has(cell_key)) {
			return parse_cell_key(cell_key);
		}
	}

	return null;
}

function can_move_piece(level, piece, direction_name, occupancy = null) {
	const direction = directions[direction_name];

	if (!piece || !direction) {
		return false;
	}

	if (!occupancy && level.runtime) {
		const runtime_occupancy = level.runtime.occupancy;
		const piece_index = piece.runtime_index;
		let uses_empty = false;
		const next_row = piece.row + direction.row;
		const next_column = piece.column + direction.column;

		for (let row_offset = 0; row_offset < piece.height; row_offset += 1) {
			for (let column_offset = 0; column_offset < piece.width; column_offset += 1) {
				const row = next_row + row_offset;
				const column = next_column + column_offset;

				if (
					row < 0 ||
					row >= level.size ||
					column < 0 ||
					column >= level.size
				) {
					return false;
				}

				const occupant = runtime_occupancy[(row * level.size) + column];

				if (occupant === blocked_cell) {
					return false;
				}

				if (occupant === empty_cell) {
					uses_empty = true;
					continue;
				}

				if (occupant !== piece_index) {
					return false;
				}
			}
		}

		return uses_empty;
	}

	const resolved_occupancy = occupancy || get_occupancy_map(level);
	let uses_empty = false;

	for (const cell of get_piece_cells(
		piece,
		piece.row + direction.row,
		piece.column + direction.column
	)) {
		const cell_key = get_cell_key(cell.row, cell.column);
		const occupying_piece_id = resolved_occupancy.get(cell_key);

		if (!level.playable_cells.has(cell_key)) {
			return false;
		}

		if (occupying_piece_id === undefined) {
			uses_empty = true;
			continue;
		}

		if (occupying_piece_id !== piece.id) {
			return false;
		}
	}

	return uses_empty;
}

function apply_move(level, move, occupancy = null) {
	if (!level) {
		return false;
	}

	if (!occupancy && level.runtime) {
		const piece = get_runtime_piece(level, move.piece_id);

		if (!piece || !can_move_piece(level, piece, move.direction)) {
			return false;
		}

		const runtime = level.runtime;
		const old_indices = [];

		for (let row_offset = 0; row_offset < piece.height; row_offset += 1) {
			for (let column_offset = 0; column_offset < piece.width; column_offset += 1) {
				const index =
					((piece.row + row_offset) * level.size) +
					piece.column +
					column_offset;
				old_indices.push(index);
				runtime.occupancy[index] = empty_cell;
			}
		}

		const direction = directions[move.direction];
		piece.row += direction.row;
		piece.column += direction.column;

		for (let row_offset = 0; row_offset < piece.height; row_offset += 1) {
			for (let column_offset = 0; column_offset < piece.width; column_offset += 1) {
				const index =
					((piece.row + row_offset) * level.size) +
					piece.column +
					column_offset;
				runtime.occupancy[index] = piece.runtime_index;
			}
		}

		runtime.empty_index = old_indices.find(
			(index) => runtime.occupancy[index] === empty_cell
		) ?? runtime.empty_index;
		return true;
	}

	const resolved_occupancy = occupancy || get_occupancy_map(level);
	const piece = level.pieces.find(
		(candidate_piece) => candidate_piece.id === move.piece_id
	);

	if (!piece || !can_move_piece(
		level,
		piece,
		move.direction,
		resolved_occupancy
	)) {
		return false;
	}

	for (const cell of get_piece_cells(piece)) {
		resolved_occupancy.delete(get_cell_key(cell.row, cell.column));
	}

	const direction = directions[move.direction];
	piece.row += direction.row;
	piece.column += direction.column;

	for (const cell of get_piece_cells(piece)) {
		resolved_occupancy.set(get_cell_key(cell.row, cell.column), piece.id);
	}

	return true;
}

function target_is_on_goal(level) {
	const target_piece = get_runtime_piece(level, target_piece_id);

	return Boolean(
		target_piece &&
		target_piece.row === level.goal.row &&
		target_piece.column === level.goal.column
	);
}

function get_target_distance(level) {
	const target_piece = get_runtime_piece(level, target_piece_id);

	return target_piece
		? Math.abs(target_piece.row - level.goal.row) +
			Math.abs(target_piece.column - level.goal.column)
		: 0;
}

function get_piece_element(piece_id) {
	if (level_data && level_data.runtime) {
		return level_data.runtime.piece_elements.get(piece_id) || null;
	}

	return board_element
		? board_element.querySelector(`.block[data-piece-id="${piece_id}"]`)
		: null;
}

function set_text_if_changed(element, value) {
	if (element && element.textContent !== value) {
		element.textContent = value;
	}
}

function update_juice_dashboard() {
	if (!level_data || !board_frame_element) {
		return;
	}

	const maximum_distance = Math.max(1, (board_size - 1) * 2);
	const proximity = 1 - (get_target_distance(level_data) / maximum_distance);
	board_frame_element.classList.toggle("target_near", proximity >= 0.68);
}

function update_game_information() {
	document.documentElement.style.setProperty("--grid_size", String(board_size));
	set_text_if_changed(level_number_element, String(level_number));
	set_text_if_changed(board_size_text_element, `${board_size} × ${board_size}`);
	set_text_if_changed(move_count_element, String(move_count));
	set_text_if_changed(flow_count_element, `×${combo_count}`);

	const board_label = `${board_size} by ${board_size} solvable sliding block board`;

	if (board_element.getAttribute("aria-label") !== board_label) {
		board_element.setAttribute("aria-label", board_label);
	}

	update_juice_dashboard();
}

function update_direction_buttons() {}

function sync_piece_element(piece) {
	const element = level_data.runtime.piece_elements.get(piece.id);

	if (!element) {
		return;
	}

	const row_value = `${piece.row + 1} / span ${piece.height}`;
	const column_value = `${piece.column + 1} / span ${piece.width}`;

	if (element.style.gridRow !== row_value) {
		element.style.gridRow = row_value;
	}

	if (element.style.gridColumn !== column_value) {
		element.style.gridColumn = column_value;
	}
}

function sync_empty_cell_visual() {
	const runtime = level_data.runtime;
	const next_index = runtime.empty_index;

	if (runtime.last_empty_index === next_index) {
		return;
	}

	if (runtime.last_empty_index >= 0) {
		const previous_element = runtime.cell_elements[runtime.last_empty_index];

		if (previous_element) {
			previous_element.classList.remove("empty_cell");
			previous_element.removeAttribute("aria-label");
		}
	}

	const next_element = runtime.cell_elements[next_index];

	if (next_element) {
		next_element.classList.add("empty_cell");
		next_element.setAttribute("aria-label", "Empty space");
	}

	runtime.last_empty_index = next_index;
}

function sync_hint_visual() {
	const runtime = level_data.runtime;

	if (
		runtime.last_hint_piece_id &&
		runtime.last_hint_piece_id !== hint_piece_id
	) {
		const previous = runtime.piece_elements.get(runtime.last_hint_piece_id);

		if (previous) {
			previous.classList.remove("hint");
			previous.removeAttribute("data-hint-arrow");
		}
	}

	if (hint_piece_id) {
		const current = runtime.piece_elements.get(hint_piece_id);
		const next_move = get_next_solution_move();

		if (current) {
			current.classList.add("hint");
			current.dataset.hintArrow = get_hint_arrow(
				next_move ? next_move.direction : ""
			);
		}
	}

	runtime.last_hint_piece_id = hint_piece_id;
}

function sync_selected_visual() {
	const runtime = level_data.runtime;

	if (
		runtime.last_selected_piece_id &&
		runtime.last_selected_piece_id !== selected_piece_id
	) {
		runtime.piece_elements
			.get(runtime.last_selected_piece_id)
			?.classList.remove("selected");
	}

	if (selected_piece_id) {
		runtime.piece_elements
			.get(selected_piece_id)
			?.classList.add("selected");
	}

	runtime.last_selected_piece_id = selected_piece_id;
}

function build_board_dom() {
	const runtime = level_data.runtime;
	const fragment = document.createDocumentFragment();
	const empty_index = runtime.empty_index;
	const empty_row = Math.floor(empty_index / board_size);
	const empty_column = empty_index % board_size;
	const empty_key = get_cell_key(empty_row, empty_column);

	for (let row = 0; row < board_size; row += 1) {
		for (let column = 0; column < board_size; column += 1) {
			const element = create_cell_element(row, column, empty_key);
			runtime.cell_elements[(row * board_size) + column] = element;
			fragment.appendChild(element);
		}
	}

	for (const piece of level_data.pieces) {
		const element = create_piece_element(piece);
		runtime.piece_elements.set(piece.id, element);
		fragment.appendChild(element);
	}

	const goal_element = create_goal_overlay_element();
	runtime.goal_element = goal_element;
	fragment.appendChild(goal_element);
	board_element.replaceChildren(fragment);
	runtime.dom_ready = true;
	runtime.last_empty_index = empty_index;
	runtime.last_hint_piece_id = hint_piece_id;
	runtime.last_selected_piece_id = selected_piece_id;
}

function render_board(changed_piece_id = null) {
	prepare_runtime_level(level_data);
	const runtime = level_data.runtime;

	if (!runtime.dom_ready) {
		build_board_dom();
	} else if (changed_piece_id) {
		const changed_piece = get_runtime_piece(level_data, changed_piece_id);

		if (changed_piece) {
			sync_piece_element(changed_piece);
		}
	} else {
		for (const piece of level_data.pieces) {
			sync_piece_element(piece);
		}
	}

	sync_empty_cell_visual();
	sync_hint_visual();
	sync_selected_visual();
	update_game_information();
}

function get_empty_cell_rect() {
	if (!level_data || !level_data.runtime) {
		return null;
	}

	const element = level_data.runtime.cell_elements[level_data.runtime.empty_index];
	return element ? element.getBoundingClientRect() : null;
}

function move_piece_by_id(piece_id, direction_name, input_intensity = 1) {
	if (game_won || auto_solving || !piece_id) {
		return false;
	}

	const moving_piece = get_runtime_piece(level_data, piece_id);

	if (!moving_piece) {
		return false;
	}

	const move = { piece_id, direction: direction_name };
	const before_rect = get_piece_rect(piece_id);
	const empty_rect_before = get_empty_cell_rect();
	const target_distance_before = moving_piece.target
		? get_target_distance(level_data)
		: 0;

	if (!apply_move(level_data, move)) {
		status_message_element.textContent =
			"That block cannot move in that direction.";
		trigger_invalid_feedback(direction_name, before_rect);
		schedule_hint();
		return false;
	}

	record_player_move(move);
	move_count += 1;
	hint_piece_id = null;
	selected_piece_id = null;
	render_board(piece_id);
	trigger_move_feedback(
		move,
		moving_piece,
		before_rect,
		target_distance_before,
		false,
		input_intensity,
		empty_rect_before
	);
	check_for_win();

	if (!game_won) {
		status_message_element.textContent =
			"Flick another block toward the empty space.";
		schedule_hint();
	}

	return true;
}

function run_auto_solve_step() {
	auto_solve_timer = null;

	if (!auto_solving || game_won || !level_data) {
		finish_auto_solve();
		return;
	}

	const next_move = get_next_solution_move();

	if (!next_move) {
		finish_auto_solve();

		if (target_is_on_goal(level_data)) {
			check_for_win();
		} else {
			status_message_element.textContent =
				"The automatic solution path became unavailable.";
			status_message_element.classList.add("error");
		}

		return;
	}

	const moving_piece = get_runtime_piece(level_data, next_move.piece_id);
	const before_rect = get_piece_rect(next_move.piece_id);
	const empty_rect_before = get_empty_cell_rect();
	const target_distance_before = moving_piece && moving_piece.target
		? get_target_distance(level_data)
		: 0;

	if (!apply_move(level_data, next_move)) {
		finish_auto_solve();
		status_message_element.textContent =
			"The automatic solution encountered an invalid move.";
		status_message_element.classList.add("error");
		trigger_invalid_feedback();
		return;
	}

	solution_path.pop();
	move_count += 1;
	selected_piece_id = next_move.piece_id;
	render_board(next_move.piece_id);
	trigger_move_feedback(
		next_move,
		moving_piece,
		before_rect,
		target_distance_before,
		true,
		0.82,
		empty_rect_before
	);

	if (target_is_on_goal(level_data)) {
		finish_auto_solve();
		check_for_win();
		return;
	}

	status_message_element.textContent =
		`Cody is solving: ${solution_path.length} moves remaining.`;
	auto_solve_timer = window.setTimeout(
		run_auto_solve_step,
		auto_solve_step_delay
	);
}

function ensure_effect_canvas() {
	if (!optimized_effect_canvas) {
		optimized_effect_canvas = document.getElementById("effects_canvas");
		optimized_effect_context = optimized_effect_canvas
			? optimized_effect_canvas.getContext("2d", { alpha: true })
			: null;
	}

	if (!optimized_effect_canvas || !optimized_effect_context) {
		return false;
	}

	const ratio = Math.min(1.5, window.devicePixelRatio || 1);
	const width = window.innerWidth;
	const height = window.innerHeight;

	if (
		width !== optimized_canvas_width ||
		height !== optimized_canvas_height ||
		ratio !== optimized_canvas_ratio
	) {
		optimized_canvas_width = width;
		optimized_canvas_height = height;
		optimized_canvas_ratio = ratio;
		optimized_effect_canvas.width = Math.round(width * ratio);
		optimized_effect_canvas.height = Math.round(height * ratio);
		optimized_effect_context.setTransform(ratio, 0, 0, ratio, 0, 0);
	}

	return true;
}

function queue_canvas_effect(effect) {
	if (prefers_reduced_motion() || !ensure_effect_canvas()) {
		return;
	}

	if (optimized_effects.length >= 110) {
		optimized_effects.splice(0, optimized_effects.length - 109);
	}

	effect.started_at = performance.now();
	optimized_effects.push(effect);

	if (optimized_effect_frame === null) {
		optimized_effect_frame = requestAnimationFrame(render_canvas_effects);
	}
}

function render_canvas_effects(now) {
	optimized_effect_frame = null;

	if (!ensure_effect_canvas()) {
		optimized_effects.length = 0;
		return;
	}

	const context = optimized_effect_context;
	context.clearRect(0, 0, optimized_canvas_width, optimized_canvas_height);
	context.save();
	context.globalCompositeOperation = "lighter";
	const alive = [];

	for (const effect of optimized_effects) {
		const progress = clamp(
			(now - effect.started_at) / effect.duration,
			0,
			1
		);

		if (progress >= 1) {
			continue;
		}

		const fade = 1 - progress;
		context.globalAlpha = fade * (effect.alpha ?? 1);

		if (effect.type === "particle") {
			const eased = 1 - ((1 - progress) * (1 - progress));
			const x = effect.x + (effect.dx * eased);
			const y = effect.y + (effect.dy * eased) + (18 * progress * progress);
			context.fillStyle = effect.color;
			context.beginPath();
			context.arc(x, y, effect.size * (1 - progress * 0.35), 0, Math.PI * 2);
			context.fill();
		} else if (effect.type === "line") {
			const x = effect.x + (effect.dx * progress);
			const y = effect.y + (effect.dy * progress);
			context.strokeStyle = effect.color;
			context.lineWidth = effect.width;
			context.lineCap = "round";
			context.beginPath();
			context.moveTo(x, y);
			context.lineTo(x - effect.dx * 0.32, y - effect.dy * 0.32);
			context.stroke();
		} else if (effect.type === "ghost") {
			context.fillStyle = effect.color;
			context.strokeStyle = "rgba(255,255,255,0.22)";
			context.lineWidth = 1.5;
			context.beginPath();
			context.roundRect(effect.x, effect.y, effect.width, effect.height, 11);
			context.fill();
			context.stroke();
		} else if (effect.type === "ring") {
			context.strokeStyle = effect.color;
			context.lineWidth = Math.max(1, 4 * fade);
			context.beginPath();
			context.arc(
				effect.x,
				effect.y,
				effect.radius * (0.35 + progress * 0.9),
				0,
				Math.PI * 2
			);
			context.stroke();
		} else if (effect.type === "trail") {
			context.fillStyle = effect.color;
			context.beginPath();
			context.roundRect(
				effect.x,
				effect.y,
				effect.width,
				effect.height,
				10
			);
			context.fill();
		} else if (effect.type === "vortex") {
			context.strokeStyle = effect.color;
			context.lineWidth = 2.5 * fade;
			context.beginPath();
			context.arc(
				effect.x + effect.dx * progress,
				effect.y + effect.dy * progress,
				effect.radius * (0.35 + progress),
				progress * 7,
				(progress * 7) + Math.PI * 1.55
			);
			context.stroke();
		}

		alive.push(effect);
	}

	context.restore();
	optimized_effects = alive;

	if (optimized_effects.length > 0) {
		optimized_effect_frame = requestAnimationFrame(render_canvas_effects);
	} else {
		context.clearRect(0, 0, optimized_canvas_width, optimized_canvas_height);
	}
}

function create_particles(rect, options = {}) {
	if (!rect || prefers_reduced_motion()) {
		return;
	}

	const center = get_rect_center(rect);
	const palette = options.palette || ["#67e8f9", "#ffffff", "#a78bfa"];
	const count = Math.min(options.count || 6, 18);

	for (let index = 0; index < count; index += 1) {
		const angle =
			(options.angle ?? Math.random() * Math.PI * 2) +
			((Math.random() - 0.5) * (options.spread ?? Math.PI * 2));
		const distance = (options.distance || 42) * (0.55 + Math.random() * 0.7);

		queue_canvas_effect({
			type: "particle",
			x: center.x + (Math.random() - 0.5) * rect.width * 0.45,
			y: center.y + (Math.random() - 0.5) * rect.height * 0.45,
			dx: Math.cos(angle) * distance,
			dy: Math.sin(angle) * distance,
			size: (options.size || 5) * (0.55 + Math.random() * 0.7),
			color: palette[index % palette.length],
			duration: 420 + Math.random() * 220,
			alpha: 0.9
		});
	}
}

function create_speed_lines(rect, direction_name, intensity = 1, color = "#ffffff") {
	if (!rect || prefers_reduced_motion()) {
		return;
	}

	const direction = directions[direction_name];

	if (!direction) {
		return;
	}

	const center = get_rect_center(rect);
	const count = Math.min(8, Math.round(3 + intensity * 2.5));

	for (let index = 0; index < count; index += 1) {
		const side = (Math.random() - 0.5) * Math.max(rect.width, rect.height);
		const distance = 34 + intensity * 26 + Math.random() * 24;

		queue_canvas_effect({
			type: "line",
			x: center.x - (direction.row * side),
			y: center.y + (direction.column * side),
			dx: direction.column * distance,
			dy: direction.row * distance,
			width: 1.5 + Math.random() * 1.5,
			color,
			duration: 180 + Math.random() * 100,
			alpha: 0.72
		});
	}
}

function create_afterimages(before_rect, after_rect, color, intensity = 1) {
	if (!before_rect || !after_rect || prefers_reduced_motion() || intensity < 1.15) {
		return;
	}

	const count = intensity > 1.7 ? 2 : 1;

	for (let index = 0; index < count; index += 1) {
		const progress = (index + 1) / (count + 1);

		queue_canvas_effect({
			type: "ghost",
			x: before_rect.left + ((after_rect.left - before_rect.left) * progress),
			y: before_rect.top + ((after_rect.top - before_rect.top) * progress),
			width: after_rect.width,
			height: after_rect.height,
			color,
			duration: 230 + index * 40,
			alpha: 0.32
		});
	}
}

function create_impact_ring(rect, color = "#ffffff", size = null) {
	if (!rect || prefers_reduced_motion()) {
		return;
	}

	const center = get_rect_center(rect);
	queue_canvas_effect({
		type: "ring",
		x: center.x,
		y: center.y,
		radius: size || Math.max(rect.width, rect.height) * 0.72,
		color,
		duration: 390,
		alpha: 0.85
	});
}

function create_move_trail(rect, color) {
	if (!rect || prefers_reduced_motion()) {
		return;
	}

	queue_canvas_effect({
		type: "trail",
		x: rect.left,
		y: rect.top,
		width: rect.width,
		height: rect.height,
		color,
		duration: 230,
		alpha: 0.24
	});
}

function create_empty_vortex(rect, direction_name, intensity = 1) {
	if (!rect || prefers_reduced_motion()) {
		return;
	}

	const center = get_rect_center(rect);
	const direction = directions[direction_name] || { row: 0, column: 0 };
	queue_canvas_effect({
		type: "vortex",
		x: center.x,
		y: center.y,
		dx: direction.column * 18,
		dy: direction.row * 18,
		radius: Math.max(rect.width, rect.height) * (0.45 + intensity * 0.08),
		color: "#93c5fd",
		duration: 420,
		alpha: 0.82
	});
}

function bump_element(element, class_name = "stat_bump", duration = 300) {
	if (!element || prefers_reduced_motion() || !element.animate) {
		return;
	}

	const keyframes = class_name === "board_shake"
		? [
			{ transform: "translateX(0)" },
			{ transform: "translateX(-6px) rotate(-0.3deg)", offset: 0.25 },
			{ transform: "translateX(5px) rotate(0.25deg)", offset: 0.5 },
			{ transform: "translateX(-2px)", offset: 0.75 },
			{ transform: "translateX(0)" }
		]
		: class_name === "win_blast"
			? [
				{ transform: "scale(1)", filter: "brightness(1)" },
				{ transform: "scale(1.025)", filter: "brightness(1.35)", offset: 0.4 },
				{ transform: "scale(1)", filter: "brightness(1)" }
			]
			: [
				{ transform: "scale(1)" },
				{ transform: "scale(1.045)", offset: 0.5 },
				{ transform: "scale(1)" }
			];

	element.animate(keyframes, {
		duration,
		easing: "cubic-bezier(0.2, 0.9, 0.25, 1)"
	});
}

function pulse_status() {
	bump_element(status_message_element, "status_pop", 260);
}

function shake_board() {
	bump_element(board_frame_element, "board_shake", 260);
}

function bump_board() {
	bump_element(board_frame_element, "board_bump", 220);
}

function trigger_move_feedback(
	move,
	piece,
	before_rect,
	target_distance_before,
	is_auto_move = false,
	input_intensity = 1,
	empty_rect_before = null
) {
	const intensity = clamp(input_intensity, 0.65, 2.2);
	const element = get_piece_element(piece.id);
	const after_rect = element ? element.getBoundingClientRect() : null;
	const direction = directions[move.direction];
	const visual_color = get_piece_visual_color(piece);

	if (element && before_rect && after_rect && element.animate && !prefers_reduced_motion()) {
		const delta_x = before_rect.left - after_rect.left;
		const delta_y = before_rect.top - after_rect.top;
		element.animate(
			[
				{
					transform: `translate(${delta_x}px, ${delta_y}px) scale(1.025)`,
					filter: "brightness(1.22) saturate(1.12)"
				},
				{
					transform: `translate(${-direction.column * 4}px, ${-direction.row * 4}px) scale(0.97, 1.03)`,
					offset: 0.72
				},
				{ transform: "translate(0, 0) scale(1)", filter: "brightness(1)" }
			],
			{
				duration: is_auto_move ? 190 : 220,
				easing: "cubic-bezier(0.18, 0.86, 0.24, 1)"
			}
		);
	}

	play_move_sound(piece, is_auto_move);
	bump_board();
	bump_element(move_count_element.closest(".game_stat"), "stat_bump", 240);
	vibrate(piece.width === 2 || piece.height === 2 ? 16 : 8);
	create_move_trail(before_rect, visual_color);
	create_impact_ring(
		after_rect,
		piece.target
			? "#fb923c"
			: piece.width === 2 || piece.height === 2
				? "#fde68a"
				: "#ffffff"
	);
	create_particles(after_rect, {
		count: piece.target ? 9 : piece.width === 2 || piece.height === 2 ? 7 : 4,
		distance: piece.target ? 52 : 36,
		size: piece.target ? 7 : 5,
		angle: Math.atan2(direction.row, direction.column),
		spread: Math.PI,
		palette: piece.target
			? ["#fb923c", "#fdba74", "#fff7ed"]
			: ["#ffffff", "#67e8f9", "#fde68a"]
	});
	create_speed_lines(after_rect, move.direction, intensity, piece.target ? "#fb923c" : "#ffffff");
	create_afterimages(before_rect, after_rect, visual_color, intensity);
	create_empty_vortex(empty_rect_before, move.direction, intensity);

	if (piece.target || piece.width === 2 || piece.height === 2 || intensity > 1.45) {
		create_edge_flash(move.direction, piece.target ? "#fb923c" : "#67e8f9", intensity);
		animate_board_tilt(move.direction, Math.min(1.4, intensity));
	}

	if (piece.width === 2 || piece.height === 2) {
		play_heavy_impact_sound();
		create_starburst(after_rect, "#fde68a", 0.55 + intensity * 0.22);
		show_floating_text("THUNK!", after_rect, "heavy");
	}

	if (!is_auto_move) {
		update_flow(true);
	}

	if (piece.target) {
		const target_distance_after = get_target_distance(level_data);
		const goal_rect = level_data.runtime.goal_element
			? level_data.runtime.goal_element.getBoundingClientRect()
			: null;

		if (target_distance_after < target_distance_before) {
			show_floating_text("CLOSER!", after_rect, "good");
			flash_screen("rgb(249 115 22 / 8%)");
			create_goal_tether(after_rect, goal_rect);
			excite_goal();
		} else if (!is_auto_move) {
			show_floating_text("DETOUR", after_rect, "combo");
		}

		update_juice_dashboard();
	} else if (!is_auto_move && combo_count >= 3 && combo_count % 2 === 1) {
		show_floating_text(`FLOW ×${combo_count}`, after_rect, "combo");
	}
}

function trigger_hint_feedback(next_move) {
	const rect = get_piece_rect(next_move.piece_id);
	play_hint_sound();
	create_impact_ring(rect, "#ffffff");
	create_particles(rect, {
		count: 7,
		distance: 32,
		size: 5,
		palette: ["#ffffff", "#93c5fd", "#c4b5fd"]
	});
	show_toast("The next correct block is pulsing");
	pulse_status();
}

function trigger_win_feedback() {
	const target_rect = get_piece_rect(target_piece_id);
	const board_rect = board_frame_element.getBoundingClientRect();

	play_win_sound();
	create_victory_rays(board_rect);
	create_starburst(target_rect, "#86efac", 2);
	flash_screen("rgb(134 239 172 / 24%)");
	bump_element(board_frame_element, "win_blast", 760);
	show_level_banner("LEVEL CLEAR", `${move_count} MOVES`, true);
	show_floating_text("GOAL!", target_rect, "good");
	vibrate([30, 25, 45, 25, 60]);
	create_particles(board_rect, {
		count: 42,
		distance: Math.min(window.innerWidth, window.innerHeight) * 0.2,
		size: 8,
		palette: ["#4ade80", "#67e8f9", "#fde68a", "#f9a8d4", "#ffffff"]
	});
}

function animate_board_intro() {
	if (prefers_reduced_motion() || !board_element || !board_element.animate) {
		return;
	}

	board_frame_element.animate(
		[
			{ opacity: 0.45, transform: "scale(0.975) translateY(8px)" },
			{ opacity: 1, transform: "scale(1) translateY(0)" }
		],
		{
			duration: 340,
			easing: "cubic-bezier(0.2, 0.85, 0.25, 1)"
		}
	);

	const pieces = level_data.pieces.slice(0, 28);

	pieces.forEach((piece, index) => {
		const element = get_piece_element(piece.id);

		if (element && element.animate) {
			element.animate(
				[
					{ opacity: 0, transform: "scale(0.82)" },
					{ opacity: 1, transform: "scale(1)" }
				],
				{
					duration: 220,
					delay: Math.min(180, index * 7),
					easing: "cubic-bezier(0.2, 0.85, 0.25, 1)",
					fill: "backwards"
				}
			);
		}
	});
}

function update_pointer_preview() {
	optimized_pointer_frame = null;

	if (!pointer_start || !optimized_pending_pointer) {
		return;
	}

	const point = optimized_pending_pointer;
	optimized_pending_pointer = null;
	pointer_start.last_x = point.x;
	pointer_start.last_y = point.y;
	const horizontal_distance = point.x - pointer_start.x;
	const vertical_distance = point.y - pointer_start.y;
	const direction_name = get_flick_direction(horizontal_distance, vertical_distance);
	const legal = can_move_piece(level_data, pointer_start.piece, direction_name);
	const resistance = legal ? 1 : flick_invalid_resistance;
	let preview_x = 0;
	let preview_y = 0;

	if (Math.abs(horizontal_distance) >= Math.abs(vertical_distance)) {
		preview_x = clamp(horizontal_distance * resistance, -flick_preview_limit, flick_preview_limit);
	} else {
		preview_y = clamp(vertical_distance * resistance, -flick_preview_limit, flick_preview_limit);
	}

	const dominant_distance = Math.max(Math.abs(horizontal_distance), Math.abs(vertical_distance));
	const charge = clamp(dominant_distance / (flick_distance_threshold * 2.25), 0, 1);
	pointer_start.element.style.setProperty("--flick-charge", String(charge));
	pointer_start.element.classList.toggle("flick_charged", legal && charge >= 0.58);
	pointer_start.element.style.transform =
		`translate3d(${preview_x}px, ${preview_y}px, 0) scale(${1.03 + charge * 0.045})`;
}

function handle_pointer_down(event) {
	const piece_element = event.target.closest(".block");

	if (!piece_element || auto_solving || game_won || event.button !== 0) {
		pointer_start = null;
		return;
	}

	event.preventDefault();
	ensure_audio_context();
	clear_hint();
	piece_element.classList.add("flicking");

	if (piece_element.setPointerCapture) {
		piece_element.setPointerCapture(event.pointerId);
	}

	pointer_start = {
		x: event.clientX,
		y: event.clientY,
		last_x: event.clientX,
		last_y: event.clientY,
		started_at: performance.now(),
		pointer_id: event.pointerId,
		piece_id: piece_element.dataset.pieceId,
		piece: get_runtime_piece(level_data, piece_element.dataset.pieceId),
		element: piece_element
	};
}

function handle_pointer_move(event) {
	if (!pointer_start || auto_solving || event.pointerId !== pointer_start.pointer_id) {
		return;
	}

	event.preventDefault();
	optimized_pending_pointer = { x: event.clientX, y: event.clientY };

	if (optimized_pointer_frame === null) {
		optimized_pointer_frame = requestAnimationFrame(update_pointer_preview);
	}
}

function finish_pointer_flick(event, cancelled = false) {
	if (!pointer_start || event.pointerId !== pointer_start.pointer_id) {
		return;
	}

	if (optimized_pointer_frame !== null) {
		cancelAnimationFrame(optimized_pointer_frame);
		optimized_pointer_frame = null;
		optimized_pending_pointer = null;
	}

	const pointer_data = pointer_start;
	pointer_start = null;

	if (
		pointer_data.element.releasePointerCapture &&
		pointer_data.element.hasPointerCapture &&
		pointer_data.element.hasPointerCapture(event.pointerId)
	) {
		pointer_data.element.releasePointerCapture(event.pointerId);
	}

	clear_pointer_preview(pointer_data);

	if (cancelled || auto_solving || game_won) {
		schedule_hint();
		return;
	}

	const horizontal_distance = event.clientX - pointer_data.x;
	const vertical_distance = event.clientY - pointer_data.y;
	const dominant_distance = Math.max(Math.abs(horizontal_distance), Math.abs(vertical_distance));
	const elapsed = Math.max(1, performance.now() - pointer_data.started_at);
	const velocity = dominant_distance / elapsed;

	if (dominant_distance < flick_distance_threshold && velocity < flick_velocity_threshold) {
		status_message_element.textContent = "Flick a block toward the empty space.";
		schedule_hint();
		return;
	}

	const direction_name = get_flick_direction(horizontal_distance, vertical_distance);
	const flick_intensity = clamp(
		0.72 + (velocity * 1.25) + (dominant_distance / 210),
		0.8,
		2.2
	);
	move_piece_by_id(pointer_data.piece_id, direction_name, flick_intensity);
}


if (
	typeof document !== "undefined" &&
	document.readyState === "loading"
) {
	document.addEventListener(
		"DOMContentLoaded",
		initialize_game
	);
} else if (typeof document !== "undefined") {
	initialize_game();
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		create_level,
		validate_level_structure,
		replay_solution,
		count_empty_cells,
		target_is_on_goal,
		apply_move,
		get_occupancy_map,
		clone_piece,
		get_piece_cells
	};
}
