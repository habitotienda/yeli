/* Timer that runs in a Worker: browsers throttle timers (and stop requestAnimationFrame)
   in background tabs, which would freeze a stream while you play a game in another window. */
let timer = null;
onmessage = (e) => {
    if (e.data.cmd === 'start') {
        clearInterval(timer);
        timer = setInterval(() => postMessage(1), e.data.ms);
    } else if (e.data.cmd === 'stop') {
        clearInterval(timer);
        timer = null;
    }
};
