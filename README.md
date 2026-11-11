# Automata

A cellular automata simulator that runs in the browser. It has an unbounded HashLife engine for rules with up to 256 states, a wrap-around grid engine for chaotic rules, and a WebGL renderer.

It comes with about 50 rules, including von Neumann's 29-state self-replicating automaton, Langton's Loops and its descendants, WireWorld, Life-like and Generations rules, Larger than Life, and cyclic automata. You can also type a rule string, paste a Golly rule table, or write the transition function in JavaScript.

## Running it locally

    python3 serve.py --open

or double-click `start.command` on a Mac. The app needs to be served over HTTP because it uses a Web Worker; opening `index.html` straight from disk will not work.

## Tests

    node test/engines.js
    node test/golly.js

## Credits

The patterns and rule tables in `patterns/golly/` come from the collection distributed with [Golly](https://golly.sourceforge.io) and remain the work of their authors, who are named in the comments at the top of each file. They include machines by William Buckley, Renato Nobili, Umberto Pesavento, Tim Hutton, Adam Goucher and others, and the WireWorld computer by David Moore and Mark Owen.

The von Neumann, Nobili and Hutton transition functions in `js/rules.js` are ported from Golly's `jvnalgo.cpp` by Tomas Rokicki, Andrew Trevorrow and Tim Hutton. `js/tables.js` is generated from Golly's rule files.

## Licence

GNU General Public License, version 2 or (at your option) any later version, the same terms as Golly. See `LICENSE`.
