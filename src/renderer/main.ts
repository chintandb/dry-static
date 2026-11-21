import { App } from './app.js';
import { mount as about } from './screens/about.js';
import { mount as consent } from './screens/consent.js';
import { mount as end } from './screens/end.js';
import { mount as framing } from './screens/framing.js';
import { mount as history } from './screens/history.js';
import { mount as round } from './screens/round.js';
import { mount as safety } from './screens/safety.js';
import { mount as settle } from './screens/settle.js';
import { mount as setup } from './screens/setup.js';

const root = document.getElementById('app');
if (!root) throw new Error('missing #app');

new App(root)
  .register('consent', consent)
  .register('safety', safety)
  .register('setup', setup)
  .register('framing', framing)
  .register('settle', settle)
  .register('round', round)
  .register('end', end)
  .register('history', history)
  .register('about', about)
  .start();
