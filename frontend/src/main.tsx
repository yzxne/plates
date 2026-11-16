import { render } from 'preact';
import { App } from './app';
import { installSelectOnFocus } from './components/NumInput';
import { refreshWorker } from './push';
import './styles.css';
import { installViewportFix } from './viewport';

installSelectOnFocus();
installViewportFix();
refreshWorker();
render(<App />, document.getElementById('app')!);
