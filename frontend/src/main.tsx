import { render } from 'preact';
import { App } from './app';
import { installSelectOnFocus } from './components/NumInput';
import './styles.css';

installSelectOnFocus();
render(<App />, document.getElementById('app')!);
