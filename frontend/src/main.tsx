import { render } from 'preact';
import { App } from './app';
import { installSelectOnFocus } from './components/NumInput';
import { refreshWorker } from './push';
import './styles.css';

installSelectOnFocus();
refreshWorker();
render(<App />, document.getElementById('app')!);
