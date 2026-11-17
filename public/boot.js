// Language and theme before the page draws (no flash of the wrong direction or colours).
try{var l=localStorage.getItem('kelvin-lang');if(l==='en'||l==='ms'){document.documentElement.lang=l;document.documentElement.dir='ltr'}}catch(e){}
try{var t=localStorage.getItem('kelvin-theme');if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t}catch(e){}
