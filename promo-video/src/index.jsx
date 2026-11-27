import { registerRoot } from 'remotion';
import { Root } from './Root.jsx';

// The app's own fonts (IBM Plex Sans and Mono).
const link = document.createElement('link');
link.rel = 'stylesheet';
link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=IBM+Plex+Sans:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=block';
document.head.appendChild(link);

registerRoot(Root);
