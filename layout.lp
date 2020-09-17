#script(python)

import random
import pyglet
import clingo

# The board width/height in tiles; must match the #const values below
WIDTH = 8
HEIGHT = 6

# Load the system default font (typically Helvetica or Arial)
font = pyglet.font.load(None, 16)

# Default window size
WWIDTH = 800
WHEIGHT = 600

# Board size (fraction of window smaller dimension)
BOARD_SIZE = 0.9


# Color constants
BORDER_COLOR = (255, 255, 255, 255)
HIDDEN_COLOR = (220, 220, 220, 255)
ZERO_COLOR = (85, 105, 255, 255)
NUM_COLOR = (100, 160, 255, 255)
BAD_COLOR = (200, 0, 0, 255)

# Number of spots to force open at random (they might self-overlap)
N_FORCE = 3

# Set clear color to black
pyglet.gl.glClearColor(0.0, 0.0, 0.0, 1.0)
pyglet.gl.glClear(pyglet.gl.GL_COLOR_BUFFER_BIT)

# Python funcitons made available to clingo directly
class Context:
    seed = 18291832
    r = random.Random()
    force = []

    def __init__(self):
        self.advance_seed()

    def advance_seed(self):
        """
        Advances the current seed and precomputes the resulting force
        positions.
        """
        self.seed = random.randint(0, 100000)
        self.r.seed(self.seed)
        self.force = []
        for i in range(N_FORCE):
            row = self.r.randint(1, WIDTH)
            col = self.r.randint(1, HEIGHT)
            self.force.append(
                clingo.Function(
                    "forced",
                    [ clingo.Function("p", [col, row]) ]
                )
            )

    def seed(self):
        """
        Returns the current seed.
        """
        return self.seed

    def forced(self):
        """
        A sequence of position predicates that have been chosen as
        force-open points based on the current seed.
        """
        return self.force

# Global context
CTX = Context()

# Drawing functions
def draw_tile(x, y, bad_neighbors, tile_dimension):
    """
    Draws a tile at (x, y).
 
    bad_neighbors should be None (for an untested tile), the string 'X'
    (for a bad tile), or a number between 0 and 8 indicating the number of
    surrounding bad tiles.
    """
    left = x - 0.46 * tile_dimension
    right = x + 0.46 * tile_dimension
    top = y - 0.46 * tile_dimension
    bot = y + 0.46 * tile_dimension
 
    ileft = x - 0.4 * tile_dimension
    iright = x + 0.4 * tile_dimension
    itop = y - 0.4 * tile_dimension
    ibot = y + 0.4 * tile_dimension
 
 
    # Border
    pyglet.gl.glColor4ub(*BORDER_COLOR)
    pyglet.gl.glBegin(pyglet.gl.GL_QUADS)
    pyglet.gl.glVertex2f(left, top)
    pyglet.gl.glVertex2f(right, top)
    pyglet.gl.glVertex2f(right, bot)
    pyglet.gl.glVertex2f(left, bot)
    pyglet.gl.glEnd()
 
    if bad_neighbors == None:
        # Inner gray square for an untested tile
        pyglet.gl.glColor4ub(*HIDDEN_COLOR)
        pyglet.gl.glBegin(pyglet.gl.GL_QUADS)
        pyglet.gl.glVertex2f(ileft, itop)
        pyglet.gl.glVertex2f(iright, itop)
        pyglet.gl.glVertex2f(iright, ibot)
        pyglet.gl.glVertex2f(ileft, ibot)
        pyglet.gl.glEnd()
    elif bad_neighbors == 0:
        # Inner blue diamond for 0-neighbor tiles
        pyglet.gl.glColor4ub(*ZERO_COLOR)
        pyglet.gl.glBegin(pyglet.gl.GL_QUADS)
        pyglet.gl.glVertex2f(ileft, y)
        pyglet.gl.glVertex2f(x, itop)
        pyglet.gl.glVertex2f(iright, y)
        pyglet.gl.glVertex2f(x, ibot)
        pyglet.gl.glEnd()
    else:
        # Draw the number or 'X' that we were given
        label = pyglet.text.Label(
            str(bad_neighbors),
            font_name='Arial',
            font_size=tile_dimension * 0.4,
            color=BAD_COLOR if bad_neighbors == 'X' else NUM_COLOR,
            x=x,
            y=y,
            anchor_x="center",
            anchor_y="center"
        )
        label.draw()


def draw_board(window, board, tested):
    """
    Draws the given board on the given window, revealing tiles where the
    given tested map holds True. Both board and tested are arrays of
    row-arays which contain values.
    """
    mid_x = window.width/2
    mid_y = window.height/2

    # tile dimension
    tdim = min(window.width / WIDTH, window.height / HEIGHT)
    tdim *= BOARD_SIZE

    for r in range(len(board)):
        for c in range(len(board[r])):
            tile = board[r][c]
            revealed = tested[r][c]
            if not revealed:
                tile = None
       
            x = mid_x + tdim * ((c - (WIDTH/2)) + 0.5)
            y = mid_y + tdim * ((r - (HEIGHT/2)) + 0.5)

            try:
                tile = int(tile)
            except:
                pass
       
            draw_tile(x, y, tile, tdim)


def draw_solution(window, solution, step):
    """
    Draws the given solution (from process_model) onto the given window.

    TODO: Allow gameplay instead of just displaying board!
    """
    board, revealed, steps = solution
    revealed_now = [
        [ st is not None and st <= step for st in row ]
        for row in revealed
    ]
    draw_board(window, board, revealed_now)


# Interface functions
def process_model(model):
    """
    Converts a clingo model into a board (a list of list of tile values)
    and a reveal-order map (a list of list of integers specifying at
    which step of the solution each tile was revealed, with None in
    places where tiles are never revealed). Along with the board and the
    reveal order map, an integer number of solution steps is returned.
    """
    board = [
        ["_" for x in range(WIDTH)]
        for y in range(HEIGHT)
    ]
    revealed = [
        [None for x in range(WIDTH)]
        for y in range(HEIGHT)
    ]
    steps = 0
    for atom in model.symbols(atoms=True):
        if atom.name == "tile":
            pos, t_ = atom.arguments
            c_, r_ = pos.arguments
            c = c_.number
            r = r_.number
            tile = str(t_).strip("\"")
            board[r-1][c-1] = tile
        elif atom.name == "initial":
            pos = atom.arguments[0]
            c_, r_ = pos.arguments
            c = c_.number
            r = r_.number
            revealed[r-1][c-1] = 0
        elif atom.name == "any_new_reveal":
            step_, pos = atom.arguments
            step = step_.number
            if step > steps:
                steps = step
            c_, r_ = pos.arguments
            c = c_.number
            r = r_.number
            revealed[r-1][c-1] = step
 
    return board, revealed, steps


def display_solutions(solgen):
    """
    Creates a pyglet window for displaying solutions from the given generator.
    """
    # Define our window and our current_solution attribute
    window = pyglet.window.Window(width=WWIDTH, height=WHEIGHT)
    current_solution = [None, None, 0]
    current_step = 0
 
    # Bind event handlers
    @window.event
    def on_draw():
        """ Draw the current solution. """
        nonlocal window, current_solution, current_step
        window.clear()
        draw_solution(window, current_solution, current_step)
 
    @window.event
    def on_key_press(symbol, modifiers):
        """ Exit if `q` is pressed, otherwise advance to the next solution. """
        if symbol in (pyglet.window.key.Q, pyglet.window.key.ESCAPE):
            pyglet.app.exit()
        else:
            advance()
 
    @window.event
    def on_mouse_press(x, y, button, modifiers):
        """ Advance to the next solution on left-click. """
        if button == pyglet.window.mouse.LEFT:
            advance()
 
    def advance():
      """
      Ask for the next solution, and update our current solution accordingly. If
      we're out of solutions, just print a message.
      """
      nonlocal solgen, current_solution, current_step
      CTX.advance_seed()
      steps = current_solution[2]
      if current_step == steps:
          try:
              print("Finding next solution...")
              model = next(solgen)
              print("...done.")
              current_solution = process_model(model)
              current_step = 0
          except StopIteration:
              print("Out of solutions.")
              pyglet.app.exit()
      else:
          current_step += 1
 
    advance()
    pyglet.app.run()

def main(prg):
    """
    Main program called automatically by clingo.
    """
    # we only want one model per solve attempt
    prg.configuration.solve.models = 1
    # make sure that there's some randomness to the search
    prg.configuration.solver.rand_freq = 0.05
    # ground the program
    prg.ground([("solve",[])], context=CTX)
    print("Finished grounding model, attempting to solve...")

    def solgen():
        captured_model = None
        def capture_model(model):
            nonlocal captured_model
            captured_model = model

        while True:
            # Disable all forced predicates
            for c in range(WIDTH):
                for r in range(HEIGHT):
                    prg.assign_external(
                        clingo.Function(
                            "forced",
                            [ clingo.Function("p", [c, r]) ]
                        ),
                        False
                    )
            # Enable whichever are current
            for pred in CTX.forced():
                prg.assign_external(pred, True)

            # Find the first solution
            print("Finding first solution...")
            captured_model = None
            result = prg.solve(on_model=capture_model)
            if result.interrupted or result.unknown:
                print("...unable to complete solving process!")
            elif result.unsatisfiable:
                print("...unable to find any solutions!")
            else:
                print("...done.")
            # Yield that solution
            if captured_model != None:
                yield captured_model
    #solgen = prg.solve(async_=True)
    display_solutions(solgen())
#end.

#program solve.

% Forbid errors...
:- error(M).
% DEBUG:
%2 >= { error(M) : error(M) }.
%:- error("Couldn't pick number of solution steps.").

#show error/1.
#show solution_steps/1.
%#show tile/2.
%#show initial/1.
%#show any_new_reveal/2.
%#show deducible_good/2.
%#show deducible_bad/2.
%#show exact_match/2.
%#show fulfilled/2.

#const width = 8.
#const height = 6.

#const max_initial_reveal_denom = 3.
#const max_single_reveal_denom = 4.

#const min_soln_length = 5.

x(1..width).
y(1..height).

% All possible positions
pos(p(X, Y)) :- x(X), y(Y).

% Neighbor relations (can't abuse symmetry because of edges)
neighbor(p(X, Y), p(X, Y2)) :- pos(p(X, Y)), pos(p(X, Y2)), Y2 = Y + 1.
neighbor(p(X, Y), p(X, Y2)) :- pos(p(X, Y)), pos(p(X, Y2)), Y2 = Y - 1.
neighbor(p(X, Y), p(X2, Y)) :- pos(p(X, Y)), pos(p(X2, Y)), X2 = X + 1.
neighbor(p(X, Y), p(X2, Y)) :- pos(p(X, Y)), pos(p(X2, Y)), X2 = X - 1.
neighbor(p(X, Y), p(X2, Y2)) :-
    pos(p(X, Y)), pos(p(X2, Y2)), X2 = X + 1, Y2 = Y + 1.
neighbor(p(X, Y), p(X2, Y2)) :-
    pos(p(X, Y)), pos(p(X2, Y2)), X2 = X - 1, Y2 = Y - 1.
neighbor(p(X, Y), p(X2, Y2)) :-
    pos(p(X, Y)), pos(p(X2, Y2)), X2 = X + 1, Y2 = Y - 1.
neighbor(p(X, Y), p(X2, Y2)) :-
    pos(p(X, Y)), pos(p(X2, Y2)), X2 = X - 1, Y2 = Y + 1.

% Area of the board
area(A) :- A = { pos(P) : pos(P) }.

% Take forced-open spots into account
#external forced(P) : pos(P).
bad(P) :- forced(P).

% Each position is either good or bad
1 = { good(P); bad(P); error(m("No assignment", P)) } :- pos(P).

% Min/max limits for # of bad positions
min_bad(B) :- area(A), B = A/7.
max_bad(B) :- area(A), B = 5*A/8.

% Enforce those limits
MIN <= { bad(P) : bad(P) } <= MAX :- min_bad(MIN), max_bad(MAX).

n_bad(NB) :- NB = { bad(P) : bad(P) }.

% Make bad tiles visible to the solution processor
tile(Pos, "X") :- bad(Pos).

% Number of bad neighbors:
bad_neighbors(Pos, N) :- pos(Pos), N = { bad(NB) : neighbor(Pos, NB) }.

% Make neighbor counts visible to the solution processor
tile(Pos, N) :- bad_neighbors(Pos, N), not bad(Pos).

% Initially revealed tiles
% min/max
min_initial(1).
max_initial(1).
%max_initial(I) :- area(A), I = A/6, min_initial(N), I >= N.
%max_initial(N) :- area(A), I = A/6, min_initial(N), I < N.

% impose those constraints
0 <= { error("Unconstrained initial.") }.
MIN <= { initial(P) : pos(P) } <= MAX :-
    min_initial(MIN),
    max_initial(MAX),
    not error("Unconstrained initial.").

% count chosen #
n_initial(NI) :- NI = { revealed_at(0, P) : revealed_at(0, P) }.

% Perform auto-reveals on initial tiles
any_new_reveal(0, I) :- initial(I).


% Solvability


max_solution_steps(S) :-
    area(A),
    n_bad(NB),
    n_initial(NI),
    S = A - NB - NI.

% Constrain solution steps
possible_solution_steps(min_soln_length..S) :- max_solution_steps(S).

% Pick a solution length
1 = {
    solution_steps(S) : possible_solution_steps(S);
    error("Couldn't pick number of solution steps.")
}.

% Enumerate solution steps
solution_step(1..S) :- solution_steps(S).

% Each step tests a non-bad tile
1 = {
    tests(S, P) : good(P), not revealed_before(S, P);
    error(m("Skipped reveal", S)) : solution_step(S)
} :- solution_step(S).

% Tiles surrounding empty tiles are auto-revealed
auto_reveal(S, P) :-
    neighbor(P, NB),
    any_new_reveal(S, NB),
    bad_neighbors(NB, 0),
    not revealed_before(S, P).

any_new_reveal(S, P) :- tests(S, P).
any_new_reveal(S, P) :- auto_reveal(S, P).

% What's revealed in total at each step?
% initial state
revealed_at(0, Pos) :- initial(Pos).
% inertia
revealed_before(Step, Pos) :-
    solution_step(Step),
    revealed_at(Before, Pos), Before < Step.
revealed_at(Step, Pos) :- revealed_before(Step, Pos).
% incremental changes
revealed_at(Step, Pos) :- any_new_reveal(Step, Pos).

% By the last solution step, all good tiles must be revealed
error(m("Good tile, never revealed.", P)) :-
    good(P),
    solution_steps(S),
    not revealed_at(S, P).

% Don't allow any bad tiles to be revealed.
error("Hit a bad tile") :- revealed_at(Step, Pos), bad(Pos).

% Unrevealed neighbor counts
unrevealed_neighbors(Step, Pos, N) :-
    solution_step(Step),
    pos(Pos), 
    N = {
        neighbor(Pos, NB)
        : neighbor(Pos, NB), not revealed_before(Step, NB)
    }.

% Exact-match revealed spots...
exact_match(Step, Pos) :-
    revealed_before(Step, Pos),
    bad_neighbors(Pos, B),
    unrevealed_neighbors(Step, Pos, B).

% Unrevealed neighbors of an exact-match tile can be deduced to be bad
deducible_simple_bad(Step, Pos) :- 
    neighbor(Pos, NB),
    exact_match(Step, NB),
    not revealed_before(Step, Pos).

deducible_bad(Step, Pos) :- deducible_simple_bad(Step, Pos).

% Double-check deduction logic
error("Incorrect simple bad deduction") :-
    deducible_simple_bad(Step, Pos),
    good(Pos).

% Fulfilled revealed spots...
fulfilled(Step, Pos) :-
    revealed_before(Step, Pos),
    bad_neighbors(Pos, BN),
    BN = { deducible_bad(Step, NB) : neighbor(Pos, NB) }.

% Unrevealed neighbors of a fulfilled tile can be deduced to be good
deducible_simple_good(Step, Pos) :-
    pos(Pos),
    solution_step(Step),
    not revealed_before(Step, Pos),
    neighbor(Pos, NB),
    fulfilled(Step, NB),
    not deducible_bad(Step, Pos).

deducible_good(Step, Pos) :- deducible_simple_good(Step, Pos).

% Double-check deduction logic
error("Incorrect simple good deduction") :-
    deducible_simple_good(Step, Pos),
    bad(Pos).

% TODO: More complex deductions?

% Deducibility of moves:
move_is_deducible(Step) :-
    solution_step(Step),
    tests(Step, Pos),
    deducible_good(Step, Pos).

% Don't allow guesses as part of our solution...
%error(m("Move was a guess", Step)) :-
%    solution_step(Step),
%    not move_is_deducible(Step).

% Require that everything be deducible at the end...
%error(m("Unknowable tile at end")) :-
%    solution_steps(Last),
%    area(A),
%    R = { revealed_at(Last, P) : revealed_at(Last, P) },
%    D = { deducible_bad(Last, P) : deducible_bad(Last, P) },
%    R + D != A.

% Count reveal size at each step
revealed_count(S, C) :-
    solution_step(S),
    C = { any_new_reveal(S, P) : any_new_reveal(S, P) }.

revealed_count(0, C) :-
    C = { any_new_reveal(0, P) : any_new_reveal(0, P) }.

% Limit initial and per-step reveal sizes
error("Too much visble at the start") :-
    area(A),
    revealed_count(0, C),
    C > A / max_initial_reveal_denom.
error("Too much revealed at once") :-
    solution_step(S),
    area(A),
    revealed_count(S, C),
    C > A / max_single_reveal_denom.

% TESTING AREA

% X31r
% XX2r
% 3X2r
% 111r
% rrrr

%bad(p(1, 1)).
%bad(p(1, 2)).
%bad(p(2, 2)).
%bad(p(2, 3)).
%
%good(p(2, 1)).
%good(p(3, 1)).
%good(p(4, 1)).
%good(p(3, 2)).
%good(p(4, 2)).
%good(p(1, 3)).
%good(p(3, 3)).
%good(p(4, 3)).
%good(p(1, 4)).
%good(p(2, 4)).
%good(p(3, 4)).
%good(p(4, 4)).
%good(p(1, 5)).
%good(p(2, 5)).
%good(p(3, 5)).
%good(p(4, 5)).
%
%initial(p(1, 5)).
%
%solution_steps(2).
%
%%#show exact_match/2.
%%#show fulfilled/2.
%%#show deducible_bad/2.
%%#show deducible_good/2.
%
%#show check/1.
%#show error/1.
%
%    %neighbor(Pos, NB),
%    %exact_match(Step, NB),
%    %    not revealed_before(Step, NB).
%check(1) :- deducible_bad(1, p(2, 3)).
%check(2) :- exact_match(1, p(3, 4)).
%check(3) :- fulfilled(1, p(3, 4)).
%check(4) :- revealed_before(1, p(3, 4)).
%check(5) :- bad_neighbors(p(3, 4), 1).
%check(6) :- unrevealed_neighbors(1, p(3, 4), 1).
%check(7) :- neighbor(p(2, 3), p(3, 4)).
%check(8) :- neighbor(p(3, 4), p(2, 3)).
%check(9) :- revealed_before(1, p(2, 3)).
%
%tests(1, p(1, 3)).
%tests(2, p(2, 1)).
