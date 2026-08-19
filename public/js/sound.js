/** 简易合成音效(无音频资源) */
const Sound = (() => {
  let ctx = null;
  function ac() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(freq, dur, type, vol, when) {
    const c = ac(), o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    const t = c.currentTime + (when || 0);
    g.gain.setValueAtTime(vol || 0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + dur);
  }
  function noise(dur, vol) {
    const c = ac(), len = c.sampleRate * dur, buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource(); src.buffer = buf;
    const g = c.createGain(); g.gain.value = vol || 0.3;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
    src.connect(f); f.connect(g); g.connect(c.destination); src.start();
  }
  return {
    click() { try { tone(660, 0.07, 'square', 0.08); } catch (e) {} },
    select() { try { tone(880, 0.06, 'sine', 0.1); } catch (e) {} },
    play() { try { tone(440, 0.09, 'triangle', 0.16); tone(660, 0.1, 'triangle', 0.14, 0.05); } catch (e) {} },
    pass() { try { tone(300, 0.12, 'sine', 0.1); } catch (e) {} },
    bomb() { try { noise(0.5, 0.5); tone(90, 0.5, 'sawtooth', 0.3); } catch (e) {} },
    win() { try { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'triangle', 0.16, i * 0.13)); } catch (e) {} },
    lose() { try { [400, 340, 280, 220].forEach((f, i) => tone(f, 0.25, 'sine', 0.14, i * 0.16)); } catch (e) {} }
  };
})();
