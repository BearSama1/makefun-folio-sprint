// The only filesystem boundary: the contest's documented JSON-in, JSON-out driver.
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {setFlagsFromString} from 'node:v8';

setFlagsFromString('--no-incremental-marking');
const {run} = await import('./solve.js');
const inputs = JSON.parse(readFileSync(join(process.env.MAKEFUN_INPUT_DIR ?? '/input', 'cases.json'),'utf8'));
const answers = inputs.map(c => run(c.input));
writeFileSync(join(process.env.MAKEFUN_OUTPUT_DIR ?? '/output','answers.json'),JSON.stringify(answers));
