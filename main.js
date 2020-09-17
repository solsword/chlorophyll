"use strict";

// ---------
// Constants
// ---------

// Global canvas context
var CTX = undefined;

// Minimum zoom-in
var MIN_SCALE = 4;

// Maximum zoom-out
var MAX_SCALE = 48;

// Comfortable scale level
var COMFORTABLE_SCALE = 17;

// How much bigger than the interest bounding box should the scale be
var IDEAL_SCALE_MULTIPLIER = 1.6;

// Speed at which to change scales (percentage of scale difference per second)
var ZOOM_IN_SPEED = 1.3
var ZOOM_OUT_SPEED = 2.5

// Speed at which to pan the origin (percentage of distance-to-ideal-origin per
// second)
var PAN_SPEED = 1.2;

// When does a touch-and-hold become a flag-it interaction instead of a
// reveal-it interaction (in milliseconds)?
var FLAG_TOUCH_DURATION = 250;

// Colors
var CURSOR_COLOR = "#bbbbbb";
var ACTIVE_CURSOR_COLOR = "#ffffff";
var UNEXPLORED_COLOR = "#666666";
var EMPTY_COLOR = "#885500";
var WARNING_COLOR = "#cc9900";
var CORRUPT_COLOR = "#990066";
var FLAG_COLOR = "#ff66bb";
var GROWTH_COLORS = [
    "#bbff88",
    "#22bb66",
    "#007722",
    "#005500",
];

// Locations which start the game revealed
var STARTING_LOCATIONS = [
    [0, 0],
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
];

// The seed for the level generation:
var SEED = 1947912873;

// The size of a tile
var TILE_SIZE = 20;

// The limits on corrupt spaces per tile
var MIN_CORRUPT_PER_TILE = 20;
var MAX_CORRUPT_PER_TILE = 120;

// Object placeholder for things we're in the process of generating
var WORKING_ON_IT = {};

// The tile cache to hold generated content.
var TILE_CACHE = {};

// Queue for tiles waiting to be generated. Each entry should be a pair
// of tile coordinates.
var GEN_QUEUE = [];

// Queue for tiles waiting to grow automatically. Each entry should be a
// array containing a max growth level followed by a pair of tile
// coordinates.
var GROWTH_QUEUE = [];

// Queue for regions waiting to be corrupted (when a corrupted tile is
// grown onto). Each entry should be a corruption region object with the
// following keys:
// "energy": The amount of undistributed energy
// "map": A map from location strings to energy values
// "list": An array of 2-element location arrays
var CORRUPTION_QUEUE = [];

// Maximum growth number for a cell, and maximum reached by auto-growth
var MAX_GROWTH = 4;
var MAX_AUTO_GROWTH = 2;

// Maximum distance-from-origin to grow at, in cells
var MAX_AUTO_DIST = 80;

// Grid coordinates that should be corrupted when their associated tile
// is generated. Keys are tile coordinate strings, and values are arrays
// of tile indices in that tile to be revealed.
var CORRUPT_WHEN_READY = {};

// Grid coordinates that should be revealed when their associated tile is
// generated. Keys are tile coordinate strings, and values are arrays of
// tile indices in that tile to be revealed.
var REVEAL_WHEN_READY = {};

// Number of tiles to generate per gen step.
var GEN_SPEED = 12;

// Delay (ms) between generation ticks
var GEN_DELAY = 2;

// Delay (ms) between test attempts
var TEST_DELAY = 50;

// Minimum and maximum callback delays (in ms):
var MIN_DELAY = 1;
var MAX_DELAY = 2000;

// How long to wait between auto growth ticks
var AUTO_GROWTH_DELAY = 60;

// Random component of auto growth delay
var AUTO_GROWTH_RANDOM_DELAY = 20;

// Seed for auto growth delay randomization
var AUTO_RNG = 29389283;

// How long to wait between auto growth ticks
var AUTO_CORRUPTION_DELAY = 30;

// Random component of auto growth delay
var AUTO_CORRUPTION_RANDOM_DELAY = 20;

// Max energy of a tile during corruption spread
var MAX_CORRUPTION_ENERGY = 3;

// Probability of corruption per point of energy
var BASE_CORRUPTION_PROBABILITY = 0.05;

// Min and max for the starting energy of a corruption region triggered
// when a corrupt cell is grown into.
var CORRUPTION_REGION_ENERGY_MIN = 12;
var CORRUPTION_REGION_ENERGY_MAX = 36;

// Probability to increase corruption energy in a region being corrupted
// instead of spreading that energy out to a new tile.
var RECORRUPT_PROBABILITY = 0.1;

// Max number of auto-growth steps per processing cycle
var MAX_AUTO_BATCH = 1024;

// Orientations
var NORTH = 1;
var EAST = 2;
var SOUTH = 4;
var WEST = 8;

// Which frame we're on:
var FRAME = 0;

// When the frame counter resets:
var MAX_FC = 1000;


// -------------------------
// Updaters & Event Handlers
// -------------------------

// Sets the scale for the given context (limited by the MIN_SCALE and
// MAX_SCALE values.
function set_scale(context, scale_factor) {
    // Scale is in world-units-per-canvas-width
    if (scale_factor < MIN_SCALE) {
        scale_factor = MIN_SCALE;
    }
    let alt_max = MAX_SCALE * context.cwidth / context.cheight;
    let limit = Math.min(MAX_SCALE, alt_max);
    if (scale_factor > limit) {
        scale_factor = limit;
    }
    context.scale = scale_factor;
}

// Zooms in one step.
function zoom_in() {
    set_scale(CTX, CTX.scale * 0.75);
}

// Zooms out one step.
function zoom_out() {
    set_scale(CTX, CTX.scale * 1/0.75);
}

// Sets the origin for the given context
function set_origin(context, origin) {
    context.origin = origin;
}

// Sets the cursor location (without moving the origin)
function set_cursor(ctx, grid_pos) {
    ctx.cursor = grid_pos;
}

// Moves the cursor relative to its current location; also sets the
// origin
function move_cursor(ctx, vector) {
    ctx.cursor[0] += vector[0];
    ctx.cursor[1] += vector[1];
    let wc = gc__wc(ctx.cursor);
    set_origin(ctx, wc);
}

// Updates the canvas size. Called on resize after a timeout.
function update_canvas_size(canvas, context) {
    var bounds = canvas.getBoundingClientRect();
    var car = bounds.width / bounds.height;
    canvas.width = 800 * car;
    canvas.height = 800;
    context.cwidth = canvas.width;
    context.cheight = canvas.height;
    context.middle = [context.cwidth / 2, context.cheight / 2];
    context.bounds = bounds;
}

// Scrolling constants
var PIXELS_PER_LINE = 18;
var LINES_PER_PAGE = 40;

// Scrolling moves the origin
function handle_scroll(ctx, ev) {
    let unit = ev.deltaMode;
    let dx = ev.deltaX;
    let dy = ev.deltaY;

    // Normalize units to pixels:
    if (unit == 1) {
        dx *= PIXELS_PER_LINE;
        dy *= PIXELS_PER_LINE;
    } else if (unit == 2) {
        dx *= PIXELS_PER_LINE * LINES_PER_PAGE;
        dy *= PIXELS_PER_LINE * LINES_PER_PAGE;
    }

    let new_origin = [
        ctx.origin[0] + dx / 100,
        ctx.origin[1] - dy / 100
    ];
    set_origin(ctx, new_origin);
}

// Returns viewport position of event.
function event_pos(ctx, ev) {
    if (ev.touches) {
        ev = ev.touches[0];
    }
    return pgc__vc(ctx, [ev.clientX, ev.clientY]);
}

// True if the given viewport coordinates are on the canvas.
function on_canvas(vc) {
    return (
        0 <= vc[0] && vc[0] <= 1
        && 0 <= vc[1] && vc[1] <= 1
    );
}


// --------------------
// Conversion functions
// --------------------

// Page <-> viewport coordinates
function pgc__vc(ctx, pc) {
    return [
        (pc[0] - ctx.bounds.left) / ctx.bounds.width,
        (pc[1] - ctx.bounds.top) / ctx.bounds.height
    ];
}

function vc__pgc(ctx, vc) {
    return [
        ctx.bounds.left + ctx.bounds.width * vc[0],
        ctx.bounds.top + ctx.bounds.height * vc[1],
    ];
}

// Viewport <-> canvas coordinates
function vc__cc(ctx, vc) {
    return [
        vc[0] * ctx.cwidth,
        vc[1] * ctx.cheight
    ];
}

function cc__vc(ctx, cc) {
    return [
        cc[0] / ctx.cwidth,
        cc[1] / ctx.cheight
    ];
}

// Canvas <-> world coordinates
function cc__wc(ctx, cc) {
    return [
        ((cc[0] - ctx.cwidth/2)/ctx.cwidth) * ctx.scale + ctx.origin[0],
        -((cc[1] - ctx.cheight/2)/ctx.cwidth) * ctx.scale + ctx.origin[1]
            // scale ignores canvas height
    ];
}

function wc__cc(ctx, wc) {
    return [
        ((wc[0] - ctx.origin[0]) / ctx.scale) * ctx.cwidth + ctx.cwidth/2,
        -((wc[1] - ctx.origin[1]) / ctx.scale) * ctx.cwidth + ctx.cheight/2
    ];
}

function canvas_unit(ctx) {
    // Returns the length of one world-coordinate unit in canvas coordinates.
    return (ctx.cwidth / ctx.scale);
}

// World <-> grid coordinates
function wc__gc(wc) {
    return [
        Math.floor(wc[0] + 0.5),
        Math.floor(wc[1] + 0.5)
    ];
}

function gc__wc(gc) {
    return [
        gc[0],
        gc[1]
    ];
}

// Grid <-> tile coordinates
function gc__tc(gc) {
    return [
        Math.floor(gc[0] / TILE_SIZE),
        Math.floor(gc[1] / TILE_SIZE)
    ];
}

function tc__gc(tc) {
    return [
        tc[0] * TILE_SIZE,
        tc[1] * TILE_SIZE
    ];
}

// Grid <-> tile indices
function gc__ti(gc) {
    let x = posmod(gc[0], TILE_SIZE);
    let y = posmod(gc[1], TILE_SIZE);
    return x + y * TILE_SIZE;
}

// Note: needs a tile coordinate to actually return a grid coordinate
function ti__gc(ti, tc) {
    return [
        tc[0] * TILE_SIZE + (ti % TILE_SIZE),
        tc[1] * TILE_SIZE + Math.floor(ti / TILE_SIZE)
    ];
}

// Page coordinates all the way to grid coordinates:
function pgc__gc(ctx, pgc) {
    return wc__gc(
        cc__wc(
            ctx,
            vc__cc(
                ctx,
                pgc__vc(ctx, pgc)
            )
        )
    );
}

// Gets extrema of canvas in the grid. Returns an object with keys 'NW', 'NE',
// 'SW', and 'SE' for each of the four corners.
function grid_extrema(ctx) {
    return {
        'NW': pgc__gc(ctx, [ ctx.bounds.left, ctx.bounds.top ]),
        'NE': pgc__gc(ctx, [ ctx.bounds.right, ctx.bounds.top ]),
        'SW': pgc__gc(ctx, [ ctx.bounds.left, ctx.bounds.bottom ]),
        'SE': pgc__gc(ctx, [ ctx.bounds.right, ctx.bounds.bottom ]),
    };
}

// Converts an orientation into an [x, y] absolute coordinate direction
// vector.
function ori__vec(ori) {
    if (ori == NORTH) {
        return [0, 1];
    } else if (ori == EAST) {
        return [1, 0];
    } else if (ori == SOUTH) {
        return [0, -1];
    } else if (ori == WEST) {
        return [-1, 0];
    } else {
        console.error("Bad orientation: " + ori);
    }
}

// Returns the direction in which an edge extends from the associated
// edge absolute coordinates, which will be either SOUTH (for EAST and
// WEST edges) or EAST (for NORTH and SOUTH edges).
function edge_ori(edge) {
    if (edge == EAST || edge == WEST) {
        return SOUTH;
    } else {
        return EAST;
    }
}

// ------------
// Drawing Code
// ------------

function draw_frame(now) {
    // Draws a single frame & loops itself

    // Measure time
    let ms_time = window.performance.now();
    if (CTX.now == undefined) {
        CTX.now = ms_time;
        window.requestAnimationFrame(draw_frame);
        return; // skip this frame to get timing for the next one
    }
    CTX.elapsed = ms_time - CTX.now;
    CTX.now = ms_time;

    // Count frames
    FRAME += 1;
    FRAME %= MAX_FC;

    // Clear the canvas
    CTX.clearRect(0, 0, CTX.cwidth, CTX.cheight);

    // Draw the world
    draw_world(CTX, SEED);

    // Draw the cursor
    draw_cursor(CTX);

    // Requeue ourselves
    if (!FAILED) {
        window.requestAnimationFrame(draw_frame);
    } else {
        console.error("Draw loop aborted due to test failure.");
    }
}

function draw_cursor(ctx) {
    let color = CURSOR_COLOR;
    if (TOUCH_STARTED != undefined) {
        // An active touch/click
        if (window.performance.now() - TOUCH_STARTED < FLAG_TOUCH_DURATION) {
            color = ACTIVE_CURSOR_COLOR;
        } else {
            color = FLAG_COLOR;
        }
    }

    let cc = wc__cc(ctx, gc__wc(ctx.cursor));
    let cell_size = canvas_unit(ctx);

    ctx.lineWidth = 54 / ctx.scale;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(cc[0] - cell_size*0.2, cc[1] - cell_size*0.2);
    ctx.lineTo(cc[0] + cell_size*0.2, cc[1] - cell_size*0.2);
    ctx.lineTo(cc[0] + cell_size*0.2, cc[1] + cell_size*0.2);
    ctx.lineTo(cc[0] - cell_size*0.2, cc[1] + cell_size*0.2);
    ctx.closePath();
    ctx.stroke();
}

function interest_bb(ctx) {
    // Computes the bounding box of the interesting region (the region
    // containing all points of each trail) in world coordinates.
    let last_reveal = ctx.last_reveal;
    if (last_reveal == undefined) {
        last_reveal = [0, 0];
    }
    let result = {
        "left": last_reveal[0],
        "right": last_reveal[0],
        "top": last_reveal[1],
        "bottom": last_reveal[1]
    }

    let prev = ctx.prev_reveal;
    if (prev != undefined) {
        if (prev[0] < result.left) { result.left = prev[0]; }
        if (prev[0] > result.right) { result.right = prev[0]; }
        if (prev[1] < result.top) { result.top = prev[1]; }
        if (prev[1] > result.bottom) { result.bottom = prev[1]; }
    }

    return result;
}

// Draws the visible portion of the world.
function draw_world(ctx, seed) {

    // Set line width:
    ctx.lineWidth = 73 / ctx.scale;

    // Iterate over visible (and a few invisible) cells at the base layer:
    let extrema = grid_extrema(ctx);

    for (let x = extrema['SW'][0] - 1; x <= extrema['SE'][0] + 1; ++x) {
        for (let y = extrema['SW'][1] - 1; y <= extrema['NW'][1] + 1; ++y) {
            // Grid and tile positions
            let gc = [x, y];
            let tc = gc__tc(gc);
            let ti = gc__ti(gc);

            // Canvas coordinates for this grid cell:
            let cc = wc__cc(ctx, gc__wc(gc));

            // Draw each grid cell...
            let neighborhood = fetch_neighborhood(gc);
            if (neighborhood == undefined) {
                draw_unrevealed(ctx, cc);
            } else {
                let cell = neighborhood[4];
                if (!cell["revealed"]) {
                    draw_unrevealed(ctx, cc);
                    if (cell["flagged"]) {
                        draw_flagged(ctx, cc);
                    }
                } else {
                    let cell_growth = cell["growth"];
                    let is_corrupted = cell["corrupted"];
                    let contamination = corrupt_count(neighborhood);
                    if (is_corrupted) {
                        draw_corruption(ctx, cc, cell_growth, neighborhood);
                    } else if (contamination > 0) {
                        draw_contamination(ctx, cc, cell_growth, neighborhood);
                    } else if (cell_growth == 0) {
                        draw_empty(ctx, cc, neighborhood);
                    } else {
                        draw_growth(ctx, cc, cell_growth, neighborhood);
                    }
                }
            }
        }
    }
}

// An unrevealed cell is just drawn as a square
function draw_unrevealed(ctx, cc) {
    let cell_size = canvas_unit(ctx);

    ctx.strokeStyle = UNEXPLORED_COLOR;
    ctx.beginPath();
    ctx.moveTo(cc[0] - cell_size/2, cc[1] - cell_size/2);
    ctx.lineTo(cc[0] + cell_size/2, cc[1] - cell_size/2);
    ctx.lineTo(cc[0] + cell_size/2, cc[1] + cell_size/2);
    ctx.lineTo(cc[0] - cell_size/2, cc[1] + cell_size/2);
    ctx.closePath();
    ctx.stroke();
}

// A flagged cell includes a smaller square on top of the unrevealed
// square
function draw_flagged(ctx, cc) {
    let cell_size = canvas_unit(ctx);

    ctx.strokeStyle = FLAG_COLOR;
    ctx.beginPath();
    ctx.moveTo(cc[0] - cell_size*0.3, cc[1] - cell_size*0.3);
    ctx.lineTo(cc[0] + cell_size*0.3, cc[1] - cell_size*0.3);
    ctx.lineTo(cc[0] + cell_size*0.3, cc[1] + cell_size*0.3);
    ctx.lineTo(cc[0] - cell_size*0.3, cc[1] + cell_size*0.3);
    ctx.closePath();
    ctx.stroke();
}

// An empty cell is drawn as a circle
function draw_empty(ctx, cc, neighborhood) {
    let cell_size = canvas_unit(ctx);

    ctx.strokeStyle = EMPTY_COLOR;
    ctx.beginPath();
    ctx.arc(cc[0], cc[1], cell_size*0.3, 0, 2*Math.PI);
    ctx.stroke();
}

// Contamination warns of surrounding corruption and is drawn (for now)
// as a numeral.
function draw_contamination(ctx, cc, growth_level, neighborhood) {
    // TODO: Draw growth
    let cell_size = canvas_unit(ctx);

    let n_corrupt = corrupt_count(neighborhood);

    ctx.fillStyle = WARNING_COLOR;
    ctx.font = (cell_size * 0.8).toFixed(0) + "px Tex Gyre Pagella";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("" + n_corrupt, cc[0], cc[1]);
}

// Corruption is drawn as an X
function draw_corruption(ctx, cc, growth_level, neighborhood) {
    // TODO: Draw growth
    let cell_size = canvas_unit(ctx);

    ctx.strokeStyle = CORRUPT_COLOR;
    ctx.beginPath();
    ctx.moveTo(cc[0] - cell_size*0.4, cc[1] - cell_size*0.4);
    ctx.lineTo(cc[0] + cell_size*0.4, cc[1] + cell_size*0.4);
    ctx.moveTo(cc[0] - cell_size*0.4, cc[1] + cell_size*0.4);
    ctx.lineTo(cc[0] + cell_size*0.4, cc[1] - cell_size*0.4);
    ctx.stroke()
}

// Growth is drawn as an isosceles triangle
function draw_growth(ctx, cc, growth_level, neighborhood) {
    let cell_size = canvas_unit(ctx);

    ctx.strokeStyle = GROWTH_COLORS[growth_level - 1];
    ctx.beginPath();
    ctx.moveTo(cc[0] - 0.3 * cell_size, cc[1] + 0.4 * cell_size);
    ctx.lineTo(cc[0], cc[1] - 0.45 * cell_size);
    ctx.lineTo(cc[0] + 0.3 * cell_size, cc[1] + 0.4 * cell_size);
    ctx.closePath();
    ctx.stroke();
}


//--------------
// Neighborhoods
//--------------

// Computes how many corrupted cells are in the given neighborhood.
function corrupt_count(neighborhood) {
    let result = 0;
    for (let i = 0; i < 9; ++i) {
        if (neighborhood[i]["corrupted"]) {
            result += 1;
        }
    }
    return result;
}

// Fetches a neighborhood for the given grid coordinates, which includes
// information for th 9 cells adjacent to and on the given grid
// coordinates. Returns undefined if any required tile information is not
// yet generated. The result is a flat array with 9 entries starting at
// x-1, y-1, proceeding across rows and then down columns to x+1, y+1 (so
// x, y-1 is the second entry). Each entry in this array is an object
// with a "growth" key containing a growth level, and "corrupted",
// "revealed" and "flagged" keys containing booleans.
function fetch_neighborhood(gc) {
    let result = [];
    let i = 0;
    for (let dy = -1; dy <= 2; ++dy) {
        for (let dx = -1; dx <= 1; ++dx) {
            let gc_here = [ gc[0] + dx, gc[1] + dy ];
            let tc_here = gc__tc(gc_here);
            let ti_here = gc__ti(gc_here);
            let tile = lookup_tile(tc_here);
            if (tile == undefined) {
                return undefined;
            } else {
                let cell = {};
                result.push(cell);
                cell["growth"] = tile["growth_levels"][ti_here];
                cell["corrupted"] = tile["corrupted"][ti_here];
                cell["revealed"] = tile["revealed"][ti_here];
                cell["flagged"] = tile["flagged"][ti_here];
            }
            i += 1;
        }
    }
    return result;
}


// ----------------
// Color Management
// ----------------

// Blends 1-r of the first color with r of the second color. Does silly
// RGB interpolation.
function blend_color(c1, c2, r) {
    c1 = c1.slice(1);
    c2 = c2.slice(1);

    let r1 = parseInt(c1.slice(0, 2), 16);
    let g1 = parseInt(c1.slice(2, 4), 16);
    let b1 = parseInt(c1.slice(4, 6), 16);
    let a1 = 255;
    if (c1.length > 6) { let a1 = parseInt(c1.slice(6, 8)); }

    let r2 = parseInt(c2.slice(0, 2), 16);
    let g2 = parseInt(c2.slice(2, 4), 16);
    let b2 = parseInt(c2.slice(4, 6), 16);
    let a2 = 255;
    if (c2.length > 6) { let a2 = parseInt(c2.slice(6, 8)); }

    let new_r = Math.floor(r1 * (1 - r) + r2 * r);
    let new_g = Math.floor(g1 * (1 - r) + g2 * r);
    let new_b = Math.floor(b1 * (1 - r) + b2 * r);
    let new_a = Math.floor(a1 * (1 - r) + a2 * r);

    let hr = new_r.toString(16);
    if (hr.length == 1) { hr = "0" + hr; }
    let hg = new_g.toString(16);
    if (hg.length == 1) { hg = "0" + hg; }
    let hb = new_b.toString(16);
    if (hb.length == 1) { hb = "0" + hb; }
    let ha = new_a.toString(16);
    if (ha.length == 1) { ha = "0" + ha; }
    return "#" + hr + hg + hb + ha;
}


// --------------
// Random Numbers
// --------------

// Implements a max-cycle-length 32-bit linear-feedback-shift-register.
// See: https://en.wikipedia.org/wiki/Linear-feedback_shift_register
function lfsr(x) {
    var lsb = x & 1;
    var r = x >>> 1;
    if (lsb) {
        r ^= 0x80200003; // 32, 22, 2, 1
    }
    return r;
}

// Uses lfsr to build a simple pseudo-random number generator.
function prng(x) {
    for (let i = 0; i < 12; ++i) {
        x = lfsr(x * 37 + i * 31);
    }
    return x;
}

// Mod operator that always returns positive results.
function posmod(n, base) {
    return ((n % base) + base) % base;
}

// Picks a random integer between 0 and the given value (inclusive) using
// the given seed.
function randint(up_to, seed) {
    return posmod(prng(seed), up_to + 1);
}

// Uses the given seed to return a floating-point value in [0, 1).
function randf(seed) {
    return prng(seed) / ((1 << 32) - 1);
}

// Flips a biased coin, returning true with probability p (determined by
// the given seed).
function flip_biased(p, seed) {
    return randf(seed) < p
}

// Picks randomly from an array using the given seed.
function choose_randomly(possibilities, seed) {
    let idx = randint(possibilities.length - 1, seed);
    return possibilities[idx];
}

// Determines the local tile seed for the given tile coordinates
function local_seed(tc) {
    return prng(prng((tc[0] + SEED) * prng(tc[1])));
}

// Shuffles the contents of the given array, according to the given seed.
// Uses the Fisher-Yates technique.
function shuffle(array, seed) {
    let rng = prng(seed);
    for (let i = 0; i < array.length; ++i) {
        let remaining = array.length - i - 1;
        let choice = randint(remaining, rng);
        let tmp = array[i];
        array[i] = array[i + choice];
        array[i + choice] = tmp;
        rng = prng(rng);
    }
}


// ------------------
// Caching and Lookup
// ------------------

// Looks up the cached tile at the given tile coordinates, or returns
// undefined and adds an entry to the generation queue if that tile is
// not yet cached.
function lookup_tile(tc) {
    let cache_key = "" + tc;
    let cache_entry = TILE_CACHE[cache_key];

    if (cache_entry == WORKING_ON_IT) {
        return undefined; // this tile is already queued up
    } else if (cache_entry != undefined) {
        return cache_entry; // cache hit
    } else {
        // cache miss: request generation
        TILE_CACHE[cache_key] = WORKING_ON_IT;
        GEN_QUEUE.push(tc);
        return undefined;
    }
}

// Self-queuing function that processes the generation queue.
function gen_step() {
    for (let i = 0; i < GEN_SPEED; ++i) {
        gen_next();
    }
    window.setTimeout(gen_step, GEN_DELAY);
}

// Generates the next tile in the generation queue.
function gen_next() {
    let next = GEN_QUEUE.shift();
    if (next == undefined) {
        return; // nothing to do right now
    }
    // Generate the tile and store it in the cache
    TILE_CACHE["" + next] = gen_tile(next);
}


// ----------------------
// Cell Modification Code
// ----------------------

// Returns True if the given grid position is revealed, and False
// otherwise. Ungenerated positions are always treated as unrevealed.
function is_revealed(gc, tile) {
    let tc = gc__tc(gc);
    if (tile == undefined) {
        tile = lookup_tile(tc);
    }

    // For not-yet-generated tiles
    if (tile == undefined) {
        return true;
    }

    let ti = gc__ti(gc);

    return tile["revealed"][ti];
}

// Reveals the cell at the given grid coordinates, or queues it to be
// revealed when the underlying tile is generated.
function reveal_cell(ctx, gc) {
    let tc = gc__tc(gc);
    let tile = lookup_tile(tc);
    let tkey = "" + tc;
    let ti = gc__ti(gc);
    if (tile == undefined) {
        if (!REVEAL_WHEN_READY.hasOwnProperty(tkey)) {
            REVEAL_WHEN_READY[tkey] = [];
        }
        if (!REVEAL_WHEN_READY[tkey].includes(ti)) {
            REVEAL_WHEN_READY[tkey].push(ti);
        }
    } else {
        tile["revealed"][ti] = true;
        // Remove flagged state 
        tile["flagged"][ti] = false;
    }

    // keep track of most-recent reveal
    ctx.prev_reveal = ctx.last_reveal;
    ctx.last_reveal = gc;
}

// Hides the cell at the given grid coordinates, or removes it from the
// queue for revelation when generated.
function obscure_cell(gc) {
    let tc = gc__tc(gc);
    let tile = lookup_tile(tc);
    let tkey = "" + tc;
    let ti = gc__ti(gc);
    if (tile == undefined) {
        if (REVEAL_WHEN_READY.hasOwnProperty(tkey)) {
            if (REVEAL_WHEN_READY[tkey].includes(ti)) {
                let old = REVEAL_WHEN_READY[tkey];
                REVEAL_WHEN_READY[tkey] = [];
                for (let index of old) {
                    if (index != ti) {
                        REVEAL_WHEN_READY[tkey].push(index);
                    }
                }
            }
        }
    } else {
        tile["revealed"][ti] = false;
        // Also un-flag it, since obscuring means info may change!
        tile["flagged"][ti] = false;
    }
}

// Returns true or false if the cell is flagged (or not) or undefined if
// it's not loaded yet.
function is_flagged(gc) {
    let tc = gc__tc(gc);
    let tile = lookup_tile(tc);
    if (tile == undefined) {
        return undefined;
    } else {
        let ti = gc__ti(gc);
        return tile["flagged"][ti];
    }
}

// Toggles flagging of the cell at the given grid coordinates, returning
// true if it succeeds. Fails and returns false if the target cell is in
// an unloaded tile.
function toggle_flag(gc) {
    // Check for existing tile info
    let tc = gc__tc(gc);
    let tile = lookup_tile(tc);
    if (tile == undefined) {
        return false;
    }

    // Toggle the flagged state only if it's unrevealed
    let ti = gc__ti(gc);
    if (!tile["revealed"][ti]) {
        tile["flagged"][ti] = !tile["flagged"][ti];
    }
    return true;
}

// Grows at the given location, returning that cell's new growth level on
// success, or undefined if it fails because that location is not yet
// loaded & revealed. Respects the given cap and does not grow above that
// value; uses MAX_GROWTH as the default cap.
function grow_at(gc, cap) {
    if (cap == undefined) {
        cap = MAX_GROWTH;
    }

    // Check for existing tile info
    let tc = gc__tc(gc);
    let tile = lookup_tile(tc);
    if (tile == undefined) {
        return undefined;
    }

    // TODO: growth types?
    // Advance the cell's growth level.
    let ti = gc__ti(gc);
    let old_level = tile["growth_levels"][ti];
    let new_level = Math.max(old_level, Math.min(cap, old_level + 1));
    tile["growth_levels"][ti] = new_level;

    // If the tile was corrupted, we trigger a corruption region!
    if (tile["corrupted"][ti]) {
        let energy = CORRUPTION_REGION_ENERGY_MIN + randint(
            CORRUPTION_REGION_ENERGY_MAX - CORRUPTION_REGION_ENERGY_MIN
        );
        AUTO_RNG = prng(AUTO_RNG);
        let region = {
            "energy": energy,
            "map": {},
            "list": [ gc ]
        };
        region.map[("" + gc)] = 1 ;
        // Hide the cell again
        obscure_cell(gc);

        CORRUPTION_QUEUE.push(region);
    }
    return new_level;
}


// Removes all growth from the target cell, returning true if it succeeds
// and false if it fails (e.g., due to an unloaded tile).
function die_at(gc) {
    // Check for existing tile info
    let tc = gc__tc(gc);
    let tile = lookup_tile(tc);
    if (tile == undefined) {
        return false;
        // TOOD: Queue of cells to die at?
    }

    // Set the cell's growth level to zero.
    let ti = gc__ti(gc);
    tile["growth_levels"][ti] = 0;

    return true;
}


// Sets the corrupted flag on a cell.
function corrupt_cell(gc) {
    let tc = gc__tc(gc);
    let tile = lookup_tile(tc);
    let tkey = "" + tc;
    let ti = gc__ti(gc);
    if (tile == undefined) {
        if (!CORRUPT_WHEN_READY.hasOwnProperty(tkey)) {
            CORRUPT_WHEN_READY[tkey] = [];
        }
        if (!CORRUPT_WHEN_READY[tkey].includes(ti)) {
            CORRUPT_WHEN_READY.push(ti);
        }
    } else {
        tile["corrupted"][ti] = true;
    }
}


//-------------------------
// Growth & Corruption Code
//-------------------------

// Self-queuing function that processes the growth queue.
function growth_step() {
    let desired = Math.ceil(GROWTH_QUEUE.length / 2);
    let actual = Math.min(MAX_AUTO_BATCH, desired);
    for (let i = 0; i < actual; ++i) {
        grow_next();
    }
    window.setTimeout(
        growth_step,
        AUTO_GROWTH_DELAY + randint(AUTO_GROWTH_RANDOM_DELAY, AUTO_RNG)
    );
    AUTO_RNG = prng(AUTO_RNG);
}

// Grows the next tile in the growth queue.
function grow_next() {
    let next = GROWTH_QUEUE.shift();
    if (next == undefined) {
        return; // nothing to do right now
    }
    let [max_level, [x, y]] = next;
    // Check distance from current origin
    let oc = wc__gc(CTX.origin);
    let odist = Math.sqrt(
        Math.pow(oc[0] - x, 2)
      + Math.pow(oc[1] - y, 2)
    );

    if (odist > MAX_AUTO_DIST) {
        // Re-enqueue to save for later...
        GROWTH_QUEUE.push(next);
        return;
    }

    // Reveal the new growth
    reveal_cell(CTX, [x, y]);
    // Grow at the destination
    let new_level = grow_at([x, y], max_level);
    if (new_level == undefined) {
        // Re-enqueue to try again
        GROWTH_QUEUE.push(next);
    } else {
        let surroundings = fetch_neighborhood([x, y]);
        if (surroundings == undefined) {
            // Re-enqueue to try again regardless of growth level
            GROWTH_QUEUE.push(next);
        } else {
            if (new_level < max_level) {
                // Enqueue neighbors if we're not contaminated
                let contamination = corrupt_count(surroundings);
                if (contamination == 0) {
                    let neighbor_vectors = [[-1, 0], [0, -1], [1, 0], [0, 1]];
                    shuffle(neighbor_vectors, AUTO_RNG);
                    AUTO_RNG = prng(AUTO_RNG);
                    for (let nbv of neighbor_vectors) {
                        let nb = [x + nbv[0], y + nbv[1]];
                        GROWTH_QUEUE.push([MAX_AUTO_GROWTH, nb]);
                    }
                    // Push diagonals after orthogonals
                    let diag_vectors = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
                    shuffle(diag_vectors, AUTO_RNG);
                    AUTO_RNG = prng(AUTO_RNG);
                    for (let nbv of diag_vectors) {
                        let nb = [x + nbv[0], y + nbv[1]];
                        GROWTH_QUEUE.push([MAX_AUTO_GROWTH, nb]);
                    }
                }
                // Re-enqueue to grow some more
                GROWTH_QUEUE.push(next);
            }
            // Otherwise we're done growing here
        }
    }
}


// Self-queuing function that processes the corruption queue.
function corruption_step() {
    let desired = Math.ceil(CORRUPTION_QUEUE.length / 2);
    let actual = Math.min(MAX_AUTO_BATCH, desired);
    for (let i = 0; i < actual; ++i) {
        corrupt_next();
    }
    window.setTimeout(
        corruption_step,
        AUTO_CORRUPTION_DELAY + randint(AUTO_CORRUPTION_RANDOM_DELAY, AUTO_RNG)
    );
    AUTO_RNG = prng(AUTO_RNG);
}


// Processes the next tile in the corruption queue.
function corrupt_next() {
    let next = CORRUPTION_QUEUE.shift();
    if (next == undefined) {
        return; // nothing to do right now
    }

    let min_dist = Math.floor(next.energy / 2);
    let distribute = min_dist + randint(next.energy - min_dist, AUTO_RNG);
    AUTO_RNG = prng(AUTO_RNG);

    // If we have undistributed energy, distribute some
    while (distribute > 0) {
        shuffle(next.list, AUTO_RNG);
        AUTO_RNG = prng(AUTO_RNG);
        for (let gc of next.list) {
            let neighbor_vectors = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            shuffle(neighbor_vectors, AUTO_RNG);
            AUTO_RNG = prng(AUTO_RNG);
            let recorrupt = flip_biased(RECORRUPT_PROBABILITY, AUTO_RNG);
            AUTO_RNG = prng(AUTO_RNG);
            for (let nbv of neighbor_vectors) {
                let nb = [gc[0] + nbv[0], gc[1] + nbv[1]];
                let nbk = "" + nb;
                if (!next.map.hasOwnProperty(nbk)) {
                    next.energy -= 1;
                    distribute -= 1;
                    next.map[nbk] = 1;
                    next.list.push(nb);
                    // Obscure the neighbor as we expand
                    obscure_cell(nb);
                    // Also destroy any growth in that space (1st attempt)
                    die_at(nb);
                    break; // move to next cell
                } else if (recorrupt && next.map[nbk] < MAX_CORRUPTION_ENERGY) {
                    next.energy -= 1;
                    distribute -= 1;
                    next.map[nbk] += 1;
                    break; // move to next cell
                } // else continue to next neighbor
            }

            // stop if we're out of energy to distribute
            if (distribute <= 0) {
                break;
            }
        }
    }

    if (next.energy > 0) {
        // If we've still got energy to distribute, re-enqueue ourselves
        // for further processing.
        CORRUPTION_QUEUE.push(next);
    } else {
        // If we're done distributing energy (i.e., hiding cells in
        // preparation for corruption) it's time to randomly add some
        // corruption.

        for (let gc of next.list) {
            let energy = next.map["" + gc];

            // Kill off any growth (2nd attempt)
            die_at(gc);

            // Randomly generate corruption
            if (flip_biased(energy * BASE_CORRUPTION_PROBABILITY, AUTO_RNG)) {
                corrupt_cell(gc);
            }
            AUTO_RNG = prng(AUTO_RNG);
        }

        // We're done with this region and by not enqueueing it again we
        // let it drop out of the active corruption regions.
    }
}


// ---------------
// Generation Code
// ---------------

// Generates a tile. A tile is a region of cells that specifies the type
// of each cell and also holds information about whether they've been
// revealed and/or flagged. It's an object with "growth_levels",
// "corrupted", "revealed" and "flagged" keys each of which is a flat
// TILE_SIZE×TILE_SIZE array. The "growth_levels" array contains a number
// fro zero to MAX_GROWTH, and the other three contain booleans. Use gc__ti
// to get tile indices into the arrays.
function gen_tile(tc) {
    let rng = local_seed(tc);
    let result = {};

    // Pick how many cells are corrupt
    let n_corrupt = (
        MIN_CORRUPT_PER_TILE + 
        randint(MAX_CORRUPT_PER_TILE - MIN_CORRUPT_PER_TILE, rng)
    );
    rng = prng(rng);

    // Shuffle corrupt cells into the central region (excluding edges)
    let corrupt = [];
    for (let ci = 0; ci < (TILE_SIZE - 2) * (TILE_SIZE - 2); ++ci) {
        if (ci < n_corrupt) {
            corrupt.push(true);
        } else {
            corrupt.push(false);
        }
    }
    shuffle(corrupt, rng);
    rng = prng(rng);

    // Consume REVEAL_WHEN_READY and CORRUPT_WHEN_READY information for
    // this tile if it exists
    let tkey = "" + tc;
    let revealed_already = [];
    if (REVEAL_WHEN_READY.hasOwnProperty(tkey)) {
        revealed_already = REVEAL_WHEN_READY[tkey];
    }

    let corrupt_already = [];
    if (CORRUPT_WHEN_READY.hasOwnProperty(tkey)) {
        corrupt_already = CORRUPT_WHEN_READY[tkey];
    }

    // Now assign cell information using corruption array
    result["growth_levels"] = [];
    result["corrupted"] = [];
    result["revealed"] = [];
    result["flagged"] = [];
    for (let ti = 0; ti < TILE_SIZE * TILE_SIZE; ++ti) {
        result["growth_levels"].push(0);
        result["revealed"].push(revealed_already.includes(ti));
        result["flagged"].push(false);

        // Figure out index into the smaller corruption array
        let tx = ti % TILE_SIZE;
        let ty = Math.floor(ti / TILE_SIZE);
        let cx = tx - 1;
        let cy = ty - 1;
        let ci = undefined;
        if (cx >= 0 && cx < TILE_SIZE - 2 && cy >= 0 && cy < TILE_SIZE - 2) {
            ci = cx + (TILE_SIZE - 2) * cy;
        }
        let is_corrupted = corrupt_already.includes(ti);
        if (!is_corrupted && ci != undefined && corrupt[ci]) {
            is_corrupted = true;
        }
        if (is_corrupted) {
            let gc = ti__gc(ti, tc);
            for (let forbidden of STARTING_LOCATIONS) {
                if (gc[0] == forbidden[0] && gc[1] == forbidden[1]) {
                    is_corrupted = false;
                    break;
                }
            }
        }
        result["corrupted"].push(is_corrupted);
    }

    // Remove used-up REVEAL_WHEN_READY and CORRUPT_WHEN_READY information
    if (REVEAL_WHEN_READY.hasOwnProperty(tkey)) {
        delete REVEAL_WHEN_READY[tkey];
    }
    if (CORRUPT_WHEN_READY.hasOwnProperty(tkey)) {
        delete CORRUPT_WHEN_READY[tkey];
    }

    // Now we can return our overall result
    return result;
}


// -----
// Reset
// -----

// Resets the world, and also advances the seed (keeps the same seed if
// advance_seed is given as false). If scramble_seed is given as true,
// sets the seed based on the current clock time.
function reset_world(advance_seed, scramble_seed) {
    if (advance_seed == undefined) {
        advance_seed = true;
    }

    if (scramble_seed == undefined) {
        scramble_seed = false;
    }

    if (scramble_seed) {
        advance_seed = true;
        SEED = window.performance.now();
    }

    if (advance_seed) {
        SEED = prng(SEED);
        AUTO_RNG = prng(SEED + 298342);
    }

    // Get rid of old data
    TILE_CACHE = {};
    GEN_QUEUE = [];
    GROWTH_QUEUE = [];
    CORRUPTION_QUEUE = [];
    CORRUPT_WHEN_READY = [];
    REVEAL_WHEN_READY = [];
    FRAME = 0;

    // Reveal initial area
    for (let gc of STARTING_LOCATIONS) {
        reveal_cell(CTX, gc);
    }

    // Reset viewport & cursor
    set_origin(CTX, [0, 0]);
    set_scale(CTX, COMFORTABLE_SCALE);
    set_cursor(CTX, [0, 0]);
}


//---------------
// Event handlers
//---------------

// When did this touch begin?
var TOUCH_STARTED = undefined;

// Event handler for touch start
function handle_touch_start(ev) {
    TOUCH_STARTED = window.performance.now();
}

// Tracks mouse/finger position & updates cursor
function handle_hover(ev) {
    let vc = event_pos(CTX, ev);
    if (on_canvas(vc)) {
        set_cursor(CTX, wc__gc(cc__wc(CTX, vc__cc(CTX, vc))));
    }
}

// Event handler for taps/clicks.
function handle_tap(ev) {
    let elapsed = window.performance.now() - TOUCH_STARTED;
    TOUCH_STARTED = undefined;
    let vc = event_pos(CTX, ev);
    if (on_canvas(vc)) {
        let gc = wc__gc(cc__wc(CTX, vc__cc(CTX, vc)));
        if (elapsed < FLAG_TOUCH_DURATION) {
            promote_growth(CTX, gc);
        } else {
            // Flag it or unflag it
            toggle_flag(gc);
        }
    }
}

// Reveals and grows the target cell
function promote_growth(ctx, gc) {
    if (is_flagged(gc)) {
        // Don't accidentally reveal a flagged spot
        return;
    }
    // Reveal and seed growth
    reveal_cell(ctx, gc);
    // Queue for growth for force further growth
    let surroundings = fetch_neighborhood(gc);
    if (surroundings == undefined || surroundings[4]["growth"] == 0) {
        GROWTH_QUEUE.push([MAX_AUTO_GROWTH, gc]); // queue for future growth
    } else {
        grow_at(gc); // force growth
    }
}

// Event handler for keyboard input.
function handle_keypress(ev) {
    if (ev.key == "R") {
        reset_world(true, true);
    } else if (ev.key == "ArrowDown") {
        move_cursor(CTX, [0, -1]);
    } else if (ev.key == "ArrowLeft") {
        move_cursor(CTX, [-1, 0]);
    } else if (ev.key == "ArrowUp") {
        move_cursor(CTX, [0, 1]);
    } else if (ev.key == "ArrowRight") {
        move_cursor(CTX, [1, 0]);
    } else if (ev.key == " ") {
        promote_growth(CTX, CTX.cursor);
    } else if (ev.key == "?" || ev.key == "z") {
        toggle_flag(CTX.cursor);
    }
}

// -------
// Testing
// -------


function same(a, b) {
    // Object-structure based equality check
    if (Array.isArray(a)) {
        if (Array.isArray(b)) {
            if (a.length != b.length) {
                return false;
            }
            for (var i = 0; i < a.length; ++i) {
                if (!same(a[i], b[i])) {
                    return false;
                }
            }
            return true;
        } else {
            return false;
        }
    } else if (typeof a === "object") {
        if (typeof b === "object") {
            // keys & values match:
            for (var k in a) {
                if (a.hasOwnProperty(k)) {
                    if (!b.hasOwnProperty(k)) {
                        return false;
                    }
                    if (!same(a[k], b[k])) {
                        return false;
                    }
                }
            }
            // extra keys in b?
            for (var k in b) {
                if (b.hasOwnProperty(k)) {
                    if (!a.hasOwnProperty(k)) {
                        return false;
                    }
                }
            }
            return true;
        } else {
            return false;
        }
    } else {
        return a === b;
    }
}


var TESTS = [
    [ "blend_color:0", blend_color("#000000ff", "#ffffffff", 0.5), "#7f7f7fff"],
    [ "same:0", same([4, 4], [4, 4]), true],
    [ "same:1", same([4, 4], [5, 5]), false],
];

var LATE_TESTS = [
];

var FAILED = false;
for (let i in TESTS) {
    let t = TESTS[i];
    let name = t[0];
    let v1 = t[1];
    let v2 = t[2];
    if (!same(v1, v2)) {
        console.error("Test '" + name + "' (#" + i + ") failed.");
        console.log("Expected:");
        console.log(v2);
        console.log("Got:");
        console.log(v1);
        FAILED = true;
    }
}

function keep_testing(tests) {
    let unresolved = [];
    for (let i in tests) {
        let t = tests[i];
        let name = t[0];
        let fv1 = t[1];
        let f1 = fv1[0];
        let a1 = fv1[1];
        let fv2 = t[2];
        let f2 = fv2[0];
        let a2 = fv2[1];

        let v1 = f1(...a1);
        let v2 = f2(...a2);

        if (v1 == undefined || v2 == undefined) {
            unresolved.push(t);
            continue;
        } else if (!same(v1, v2)) {
            console.error("Late Test '" + name + "' (#" + i + ") failed.");
            console.log("Expected:");
            console.log(v2);
            console.log("Got:");
            console.log(v1);
            FAILED = true;
        }
    }
    if (unresolved.length > 0) {
        window.setTimeout(keep_testing, TEST_DELAY, unresolved);
    } else {
        if (FAILED) {
            console.log("Late tests done failing.");
        } else {
            console.log("Late tests all passed.");
        }
    }
}

keep_testing(LATE_TESTS);

// -----
// Setup
// -----

// Run when the document is loaded unless a test failed

if (!FAILED) {
    // Grab canvas & context:
    let canvas = document.getElementById("world");
    CTX = canvas.getContext("2d");

    // Set initial canvas size & scale:
    update_canvas_size(canvas, CTX);

    // Reset the world
    reset_world(true, true);

    // Listen for window resizes but wait until 20 ms after the last
    // consecutive one to do anything.
    var timer_id = undefined;
    window.addEventListener("resize", function() {
        if (timer_id != undefined) {
            clearTimeout(timer_id);
            timer_id = undefined;
        }
        timer_id = setTimeout(
            function () {
                timer_id = undefined;
                update_canvas_size(canvas, CTX);
            },
            20 // milliseconds
        );
    });

    // Scrolling moves the origin
    document.onwheel = function(ev) {
        if (ev.preventDefault) { ev.preventDefault(); }
        handle_scroll(CTX, ev);
    }

    // Clicking (or tapping) grows or flags
    canvas.addEventListener("mousedown", handle_touch_start);
    canvas.addEventListener("touchstart", handle_touch_start);
    canvas.addEventListener("click", handle_tap);
    canvas.addEventListener("touchend", handle_tap);
    canvas.addEventListener("mousemove", handle_hover);
    canvas.addEventListener("touchmove", handle_hover);
    // Keyboard shortcuts
    document.addEventListener("keydown", handle_keypress);

    // Reset button
    document.getElementById("reset").addEventListener(
        "click",
        function () { reset_world(true, true); }
    );

    document.getElementById("zoom_in").addEventListener("click", zoom_in);
    document.getElementById("zoom_out").addEventListener("click", zoom_out);

    // Draw every frame
    window.requestAnimationFrame(draw_frame);

    // Kick off generation subsystem
    gen_step();

    // Kick off auto-growth and corruption
    growth_step();
    corruption_step();
}
