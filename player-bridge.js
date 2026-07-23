// Relays Watch Party commands through StreamiLoo's nested, cross-origin
// player frames and controls the HTMLVideoElement in the deepest frame.
(() => {
    if (window.__WP_PLAYER_BRIDGE__) return;
    window.__WP_PLAYER_BRIDGE__ = true;

    const SOURCE = 'watch-party-player-bridge';
    let video = null;
    let remoteAction = false;
    const attachedVideos = new WeakSet();

    function sendEvent(event, extra = {}) {
        if (window.parent === window) return;
        window.parent.postMessage({ source: SOURCE, kind: 'event', event, ...extra }, '*');
    }

    function attachVideo(candidate) {
        if (!candidate) return;
        video = candidate;
        if (attachedVideos.has(candidate)) return;
        attachedVideos.add(candidate);

        candidate.addEventListener('play', () => {
            if (!remoteAction) sendEvent('play', { currentTime: candidate.currentTime });
        });
        candidate.addEventListener('pause', () => {
            if (!remoteAction) sendEvent('pause', { currentTime: candidate.currentTime });
        });
        candidate.addEventListener('seeked', () => {
            if (!remoteAction) sendEvent('seeked', { currentTime: candidate.currentTime });
        });
        candidate.addEventListener('waiting', () => sendEvent('buffering'));
        candidate.addEventListener('canplay', () => sendEvent('canplay'));
        candidate.addEventListener('timeupdate', () => {
            sendEvent('timeupdate', { currentTime: candidate.currentTime });
        });
        sendEvent('ready', {
            currentTime: candidate.currentTime,
            paused: candidate.paused
        });
    }

    function findVideo() {
        const videos = Array.from(document.querySelectorAll('video'));
        if (!videos.length) return;
        attachVideo(videos.reduce((best, item) => {
            if (!best || (!item.paused && best.paused)) return item;
            return item.duration > (best.duration || 0) ? item : best;
        }, null));
    }

    function relayToChildren(message) {
        document.querySelectorAll('iframe').forEach((frame) => {
            try { frame.contentWindow?.postMessage(message, '*'); } catch {}
        });
    }

    window.addEventListener('message', (event) => {
        const message = event.data;
        if (!message || message.source !== SOURCE) return;

        if (message.kind === 'event') {
            const isChildFrame = Array.from(document.querySelectorAll('iframe'))
                .some((frame) => frame.contentWindow === event.source);
            if (!isChildFrame) return;
            // Bubble events one frame at a time so the StreamiLoo page receives
            // them from its own playerFrame rather than an unknown deep frame.
            if (window.parent !== window) window.parent.postMessage(message, '*');
            return;
        }

        if (message.kind !== 'command' || event.source !== window.parent) return;
        relayToChildren(message);
        if (!video) findVideo();
        if (!video) return;

        remoteAction = true;
        const time = Number(message.currentTime);
        if (Number.isFinite(time) && Math.abs(video.currentTime - time) > 0.35) {
            video.currentTime = time;
        }
        if (message.command === 'play') video.play().catch(() => {});
        if (message.command === 'pause') video.pause();
        window.setTimeout(() => { remoteAction = false; }, 900);
    });

    new MutationObserver(findVideo).observe(document.documentElement, {
        childList: true,
        subtree: true
    });
    window.setInterval(findVideo, 750);
    findVideo();
})();
