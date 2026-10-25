/* tombi.js — הדרקון טומבי: ציור על קנבס עם לסת שזזה, מצמוץ, נשימה ודיבור.
   הקואורדינטות כאן הן ביחידות של התמונה המקורית (2048x2048). */
T.tombi = (() => {
  const BASE = 2048;
  const SOURCE_SCALE = BASE / 1800;
  const FOCUS = { x: 1060, y: 860 };
  const MOUTH_BOX = { x: 820, y: 800, w: 400, h: 250 };
  const SIMULATION_MOUTH_BOX = { x: 468, y: 245, w: 152, h: 120 };
  const MOUTH_SHAPES = ['closed', 'slight', 'open', 'round'];
  const MOUTH_CROSSFADE_MS = 90;
  const MOUTH_CONTRAST = 1.6;
  const MOUTH_ANCHOR_Y = 68;
  const MOUTH_FRAME_SCALES = [1, 1.22, 1.52, 1.4];
  const SIMULATION_MOUTH_FRAME_SCALES = [1, 1.12, 1.32, 1.5];
  const MOUTH_MASK = { x: 200, y: 100, rx: 72, ry: 38 };
  const EYES = [{ x: 959, y: 792, rx: 100, ry: 80 }, { x: 1233, y: 778, rx: 90, ry: 82 }];
  const SIMULATION_EYES = [{ x: 490, y: 224, rx: 26, ry: 29 }, { x: 579, y: 224, rx: 26, ry: 29 }];
  const SIMULATION_BREATH_CENTER = { x: 505, y: 350 };
  let img, simulationBackground, simulationArtwork, simulationChestMask, simulationMotionCanvas, simulationMotionContext;
  let eyelidTextures = [], simulationEyelidTextures = [], canvas, g;
  let mouthSprites = [], simulationMouthSprites = [], simulationMode = false;
  let mouthDrive = 0, mouthDriveTarget = 0, mouthShapeTarget = 0;
  let mouthWeights = [1, 0, 0, 0], mouthStartWeights = [1, 0, 0, 0], mouthFadeElapsed = MOUTH_CROSSFADE_MS;
  let mouthPulseShape = null, mouthPulseUntil = 0;
  let bob = 0, hop = 0, glow = 0, blink = 0, nextBlink = 2500;
  let soundSensitive = false;
  let talking = false, talkPhase = 0, talkWord = '', talkWordDuration = 0.3, wordTimed = false;
  let mood = 'idle', analyser = null, anaBuf = null;
  let lastTs = 0, forced = null, blinkHold = null;

  function buildMouth(src) {
    const baseUrl = new URL(src, document.baseURI);
    return Promise.all(MOUTH_SHAPES.map((shape) => new Promise((resolve, reject) => {
      const sprite = new Image();
      sprite.onload = () => resolve(sprite);
      sprite.onerror = () => reject(new Error(`Unable to load mouth sprite: ${shape}`));
      sprite.src = new URL(`mouth/${shape}.png`, baseUrl).href;
    }))).then((sprites) => {
      const closedCanvas = document.createElement('canvas');
      closedCanvas.width = sprites[0].naturalWidth;
      closedCanvas.height = sprites[0].naturalHeight;
      const closedContext = closedCanvas.getContext('2d', { willReadFrequently: true });
      closedContext.drawImage(sprites[0], 0, 0);
      const closedPixels = closedContext.getImageData(0, 0, closedCanvas.width, closedCanvas.height).data;
      const enhancedSprites = [sprites[0], ...sprites.slice(1).map((sprite, index) => {
        const canvas = document.createElement('canvas');
        canvas.width = sprite.naturalWidth;
        canvas.height = sprite.naturalHeight;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(sprite, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < pixels.data.length; i += 4) {
          for (let channel = 0; channel < 3; channel++) {
            pixels.data[i + channel] = Math.max(0, Math.min(255,
              closedPixels[i + channel] + (pixels.data[i + channel] - closedPixels[i + channel]) * MOUTH_CONTRAST));
          }
        }
        context.putImageData(pixels, 0, 0);
        return buildAnimatedMouthFrame(sprites[0], canvas, MOUTH_FRAME_SCALES[index + 1]);
      })];
      mouthSprites = enhancedSprites;
    });
  }

  function buildAnimatedMouthFrame(closedSprite, openSprite, verticalScale, anchorY = MOUTH_ANCHOR_Y, maskShape = MOUTH_MASK, transparentOutsideMask = false) {
    const frame = document.createElement('canvas');
    frame.width = closedSprite.naturalWidth || closedSprite.width;
    frame.height = closedSprite.naturalHeight || closedSprite.height;
    const frameContext = frame.getContext('2d');
    frameContext.drawImage(closedSprite, 0, 0);

    const movingMouth = document.createElement('canvas');
    movingMouth.width = frame.width;
    movingMouth.height = frame.height;
    const movingContext = movingMouth.getContext('2d');
    movingContext.translate(0, anchorY * (1 - verticalScale));
    movingContext.scale(1, verticalScale);
    movingContext.drawImage(openSprite, 0, 0);

    const mask = document.createElement('canvas');
    mask.width = frame.width;
    mask.height = frame.height;
    const maskContext = mask.getContext('2d');
    maskContext.save();
    maskContext.translate(maskShape.x, maskShape.y);
    maskContext.scale(1, maskShape.ry / maskShape.rx);
    const gradient = maskContext.createRadialGradient(0, 0, maskShape.rx * 0.78, 0, 0, maskShape.rx);
    gradient.addColorStop(0, '#fff');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    maskContext.fillStyle = gradient;
    maskContext.beginPath();
    maskContext.arc(0, 0, maskShape.rx, 0, Math.PI * 2);
    maskContext.fill();
    maskContext.restore();

    movingContext.setTransform(1, 0, 0, 1, 0, 0);
    movingContext.globalCompositeOperation = 'destination-in';
    movingContext.drawImage(mask, 0, 0);
    frameContext.drawImage(movingMouth, 0, 0);
    if (transparentOutsideMask) {
      // Simulation frames sit above the breathing chest, not an opaque face/chest crop.
      frameContext.globalCompositeOperation = 'destination-in';
      frameContext.drawImage(mask, 0, 0);
    }
    return frame;
  }

  function setMouthShape(shape) {
    if (shape === mouthShapeTarget) return;
    mouthStartWeights = mouthWeights.slice();
    mouthShapeTarget = shape;
    mouthFadeElapsed = 0;
  }

  function updateMouthFade(dt) {
    if (mouthFadeElapsed >= MOUTH_CROSSFADE_MS) return;
    mouthFadeElapsed = Math.min(MOUTH_CROSSFADE_MS, mouthFadeElapsed + dt);
    const rawProgress = mouthFadeElapsed / MOUTH_CROSSFADE_MS;
    const progress = rawProgress * rawProgress * (3 - 2 * rawProgress);
    mouthWeights = mouthStartWeights.map((weight, index) =>
      weight * (1 - progress) + (index === mouthShapeTarget ? progress : 0));
  }

  function mouthShapeForDrive(level) {
    if (level < 0.12) return 0;
    if (level < 0.42) return 1;
    if (level < 0.78) return 2;
    return 3;
  }

  function pulseMouth(shape, duration) {
    mouthPulseShape = shape;
    mouthPulseUntil = performance.now() + duration;
  }

  function mount(el, src) {
    canvas = el;
    g = canvas.getContext('2d');
    return new Promise((res, rej) => {
      img = new Image();
      img.onload = async () => {
        try {
          const assetBase = new URL(src, document.baseURI);
          const loadAsset = (name, onLoad, errorMessage) => new Promise((resolve, reject) => {
            const asset = new Image();
            asset.onload = () => { onLoad(asset); resolve(); };
            asset.onerror = () => reject(new Error(errorMessage));
            asset.src = new URL(name, assetBase).href;
          });
          await Promise.all([
            buildMouth(src),
            loadAsset('simulation-forest-bg.png', (asset) => { simulationBackground = asset; }, 'Unable to load simulation background image'),
          ]);
          simulationArtwork = simulationBackground;
          eyelidTextures = buildEyelidTextures(img, EYES, img.naturalWidth / BASE, img.naturalHeight / BASE);
          buildSimulationMotionLayer();
          resize();
          requestAnimationFrame(loop);
          res();
        } catch (error) {
          rej(error);
        }
      };
      img.onerror = () => rej(new Error(`Unable to load Tombi image: ${src}`));
      img.src = src;
    });
  }

  function resize() {
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(10, Math.round(r.width * dpr));
    canvas.height = Math.max(10, Math.round(r.height * dpr));
  }
  window.addEventListener('resize', resize);

  function buildEyelidTextures(source, eyes, sourceScaleX = 1, sourceScaleY = 1) {
    const sourcePixelsCanvas = document.createElement('canvas');
    sourcePixelsCanvas.width = source.naturalWidth;
    sourcePixelsCanvas.height = source.naturalHeight;
    const sourcePixelsContext = sourcePixelsCanvas.getContext('2d', { willReadFrequently: true });
    sourcePixelsContext.drawImage(source, 0, 0);
    const sourcePixels = sourcePixelsContext.getImageData(0, 0, sourcePixelsCanvas.width, sourcePixelsCanvas.height);
    const sampleColor = (x, y) => {
      const pixel = (Math.round(y) * sourcePixels.width + Math.round(x)) * 4;
      if (sourcePixels.data[pixel + 3] < 128) throw new Error('Unable to sample fur color for eyelid');
      return [sourcePixels.data[pixel], sourcePixels.data[pixel + 1], sourcePixels.data[pixel + 2]];
    };

    return eyes.map((eye) => {
      const lid = { ...eye, rx: eye.rx * 0.88, ry: eye.ry * 0.82 };
      const createTexture = (side) => {
        const patch = document.createElement('canvas');
        patch.width = Math.ceil(lid.rx * 2);
        patch.height = Math.ceil(lid.ry);
        const context = patch.getContext('2d');
        const pixels = context.createImageData(patch.width, patch.height);
        const sampleXOffset = lid.rx * 0.12 + 2;
        const sampleLeftX = (eye.x - lid.rx - sampleXOffset) * sourceScaleX;
        const sampleRightX = (eye.x + lid.rx + sampleXOffset) * sourceScaleX;
        const smoothRadius = Math.max(1, Math.round(patch.height * 0.06));
        for (let y = 0; y < patch.height; y++) {
          const sourceY = side === 'upper'
            ? (eye.y - lid.ry + y * lid.ry / patch.height) * sourceScaleY
            : (eye.y + y * lid.ry / patch.height) * sourceScaleY;
          const leftColor = [0, 0, 0];
          const rightColor = [0, 0, 0];
          for (let offset = -smoothRadius; offset <= smoothRadius; offset++) {
            const sampleY = sourceY + offset * sourceScaleY;
            const leftSample = sampleColor(sampleLeftX, sampleY);
            const rightSample = sampleColor(sampleRightX, sampleY);
            for (let channel = 0; channel < 3; channel++) {
              leftColor[channel] += leftSample[channel];
              rightColor[channel] += rightSample[channel];
            }
          }
          const sampleCount = smoothRadius * 2 + 1;
          for (let x = 0; x < patch.width; x++) {
            const mix = x / (patch.width - 1);
            const pixel = (y * patch.width + x) * 4;
            for (let channel = 0; channel < 3; channel++) {
              const left = leftColor[channel] / sampleCount;
              const right = rightColor[channel] / sampleCount;
              pixels.data[pixel + channel] = left * (1 - mix) + right * mix;
            }
            const normalizedX = (mix - 0.5) * 2;
            const normalizedY = side === 'upper' ? y / patch.height - 1 : y / patch.height;
            const edgeDistance = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY);
            pixels.data[pixel + 3] = Math.round(255 * Math.min(1, Math.max(0, (1 - edgeDistance) / 0.1)));
          }
        }
        context.putImageData(pixels, 0, 0);
        return patch;
      };
      return { upper: createTexture('upper'), lower: createTexture('lower') };
    });
  }

  function buildSimulationMotionLayer() {
    const width = simulationBackground.naturalWidth;
    const height = simulationBackground.naturalHeight;
    const mouthWidth = SIMULATION_MOUTH_BOX.w;
    const mouthHeight = SIMULATION_MOUTH_BOX.h;
    const simulationMouth = document.createElement('canvas');
    simulationMouth.width = mouthWidth;
    simulationMouth.height = mouthHeight;
    simulationMouth.getContext('2d').drawImage(simulationArtwork,
      SIMULATION_MOUTH_BOX.x, SIMULATION_MOUTH_BOX.y, mouthWidth, mouthHeight,
      0, 0, mouthWidth, mouthHeight);
    const mouthScaleX = mouthWidth / MOUTH_BOX.w;
    const mouthScaleY = mouthHeight / MOUTH_BOX.h;
    const simulationMask = {
      x: MOUTH_MASK.x * mouthScaleX,
      y: MOUTH_MASK.y * mouthScaleY,
      rx: MOUTH_MASK.rx * mouthScaleX,
      ry: MOUTH_MASK.ry * mouthScaleY,
    };
    simulationMouthSprites = SIMULATION_MOUTH_FRAME_SCALES.map((scale) => buildAnimatedMouthFrame(
      simulationMouth,
      simulationMouth,
      scale,
      MOUTH_ANCHOR_Y * mouthScaleY,
      simulationMask,
      true,
    ));

    simulationEyelidTextures = buildEyelidTextures(simulationBackground, SIMULATION_EYES);

    simulationChestMask = document.createElement('canvas');
    simulationChestMask.width = width;
    simulationChestMask.height = height;
    const maskContext = simulationChestMask.getContext('2d');
    maskContext.filter = 'blur(6px)';
    maskContext.beginPath();
    maskContext.ellipse(SIMULATION_BREATH_CENTER.x, SIMULATION_BREATH_CENTER.y, 40, 30, 0, 0, Math.PI * 2);
    maskContext.fillStyle = '#fff';
    maskContext.fill();

    simulationMotionCanvas = document.createElement('canvas');
    simulationMotionCanvas.width = width;
    simulationMotionCanvas.height = height;
    simulationMotionContext = simulationMotionCanvas.getContext('2d');
  }

  function loop(ts) {
    const dt = Math.min(50, ts - (lastTs || ts));
    lastTs = ts;
    update(dt, ts);
    draw(ts);
    requestAnimationFrame(loop);
  }

  function update(dt, ts) {
    let selectedShape = 0;
    if (analyser) {
      analyser.getFloatTimeDomainData(anaBuf);
      let e = 0;
      for (let i = 0; i < anaBuf.length; i++) e += anaBuf[i] * anaBuf[i];
      const rms = Math.sqrt(e / anaBuf.length);
      mouthDriveTarget = Math.max(0, Math.min(1, (rms - 0.008) / 0.11));
      selectedShape = mouthShapeForDrive(mouthDriveTarget);
    } else if (talking) {
      talkPhase += dt / 1000;
      if (wordTimed) {
        const syllables = Math.max(1, Math.min(4, Math.ceil(Array.from(talkWord).length / 2.5)));
        const progress = talkPhase / talkWordDuration;
        if (progress < 1) {
          const syllableProgress = (progress * syllables) % 1;
          const syllableIndex = Math.min(syllables - 1, Math.floor(progress * syllables));
          const character = Array.from(talkWord)[Math.min(Array.from(talkWord).length - 1, syllableIndex * 2)] || '';
          selectedShape = syllableProgress < 0.16 ? 1 :
            /[וום]/.test(character) ? 3 :
              syllableProgress < 0.76 ? 2 : 1;
        }
      } else {
        const syllable = (talkPhase * 3.4) % 1;
        const pulse = Math.sin(Math.PI * syllable);
        const phrase = 0.72 + 0.28 * Math.sin(talkPhase * 2 * Math.PI * 1.15 + 1);
        mouthDriveTarget = 0.58 * pulse * phrase;
        selectedShape = mouthShapeForDrive(mouthDriveTarget);
      }
    } else {
      mouthDriveTarget = 0;
    }
    if (forced !== null) {
      mouthDriveTarget = forced;
      selectedShape = mouthShapeForDrive(forced);
    }
    if (mouthPulseShape !== null) {
      if (performance.now() < mouthPulseUntil) selectedShape = mouthPulseShape;
      else { mouthPulseShape = null; selectedShape = 0; }
    }
    if (forced !== null) mouthDrive = forced;
    const tau = mouthDriveTarget > mouthDrive ? 40 : 90;
    mouthDrive += (mouthDriveTarget - mouthDrive) * (1 - Math.exp(-dt / tau));
    if (mouthDrive < 0.002) mouthDrive = 0;
    if (mouthPulseShape !== null || (forced !== null) || (!analyser && talking && wordTimed)) {
      setMouthShape(selectedShape);
    } else {
      setMouthShape(mouthShapeForDrive(mouthDrive));
    }
    updateMouthFade(dt);
    bob += dt / 1000;
    hop = Math.max(0, hop - dt / 700);
    nextBlink -= dt;
    if (nextBlink <= 0) { blink = 1; nextBlink = 2500 + Math.random() * 3500; }
    blink = Math.max(0, blink - dt / 170);
    if (blinkHold !== null) blink = blinkHold;
    const lv = T.audio && T.audio.level;
    const want = mood === 'listen' ? (lv && lv.active ? Math.min(1, 0.35 + (lv.db - lv.floor) / 30) : 0.18) : 0;
    glow += (want - glow) * 0.2;
  }

  function draw(ts) {
    const W = canvas.width, H = canvas.height;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    if (simulationMode) {
      const backgroundScale = Math.max(W / simulationBackground.naturalWidth, H / simulationBackground.naturalHeight);
      const backgroundWidth = simulationBackground.naturalWidth * backgroundScale;
      const backgroundHeight = simulationBackground.naturalHeight * backgroundScale;
      const backgroundX = (W - backgroundWidth) / 2;
      const backgroundY = (H - backgroundHeight) / 2;
      g.drawImage(simulationArtwork, backgroundX, backgroundY, backgroundWidth, backgroundHeight);

      const breathPhase = (ts * Math.PI * 2) / 3600;
      const breath = 1 + 0.1 * Math.sin(breathPhase);
      const breathLift = -2.5 * Math.max(0, Math.sin(breathPhase));
      simulationMotionContext.clearRect(0, 0, simulationMotionCanvas.width, simulationMotionCanvas.height);
      simulationMotionContext.save();
      simulationMotionContext.translate(SIMULATION_BREATH_CENTER.x, SIMULATION_BREATH_CENTER.y + breathLift);
      simulationMotionContext.scale(breath, 1 + (breath - 1) * 1.3);
      simulationMotionContext.translate(-SIMULATION_BREATH_CENTER.x, -SIMULATION_BREATH_CENTER.y);
      simulationMotionContext.drawImage(simulationArtwork, 0, 0);
      simulationMotionContext.restore();
      simulationMotionContext.globalCompositeOperation = 'destination-in';
      simulationMotionContext.drawImage(simulationChestMask, 0, 0);
      simulationMotionContext.globalCompositeOperation = 'source-over';
      // Add premultiplied masked pixels after removing the same coverage.
      // source-over here would attenuate the soft edge twice and leave a dark seam.
      g.save();
      g.globalCompositeOperation = 'destination-out';
      g.drawImage(simulationChestMask, backgroundX, backgroundY, backgroundWidth, backgroundHeight);
      g.globalCompositeOperation = 'lighter';
      g.drawImage(simulationMotionCanvas, backgroundX, backgroundY, backgroundWidth, backgroundHeight);
      g.restore();
      g.save();
      g.translate(backgroundX, backgroundY);
      g.scale(backgroundScale, backgroundScale);
      g.save();
      MOUTH_SHAPES.forEach((_, index) => {
        if (mouthWeights[index] <= 0) return;
        g.globalAlpha = mouthWeights[index];
        g.drawImage(simulationMouthSprites[index], SIMULATION_MOUTH_BOX.x, SIMULATION_MOUTH_BOX.y,
          SIMULATION_MOUTH_BOX.w, SIMULATION_MOUTH_BOX.h);
      });
      g.restore();
      drawBlink(SIMULATION_EYES);
      g.restore();

      g.save();
      g.translate(backgroundX, backgroundY);
      g.scale(backgroundScale / (BASE / simulationBackground.naturalWidth), backgroundScale / (BASE / simulationBackground.naturalWidth));
      drawLights(ts, true);
      g.restore();
      return;
    }

    const fit = Math.max(W / BASE, H / BASE);
    const push = 1 + 0.025 * Math.sin(Math.min(1, hop) * Math.PI);
    const breathe = 1 + 0.004 * Math.sin((bob * 2 * Math.PI) / 3.6);
    const sc = fit * push * breathe;
    const vw = W / sc, vh = H / sc;
    const cx = vw >= BASE ? BASE / 2 : Math.max(vw / 2, Math.min(BASE - vw / 2, FOCUS.x));
    const cy = vh >= BASE ? BASE / 2 : Math.max(vh / 2, Math.min(BASE - vh / 2, FOCUS.y));
    g.translate(W / 2, H / 2);
    g.scale(sc, sc);
    g.translate(-cx, -cy);
    g.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, 0, BASE, BASE);
    g.save();
    MOUTH_SHAPES.forEach((_, index) => {
      if (mouthWeights[index] <= 0) return;
      g.globalAlpha = mouthWeights[index];
      g.drawImage(mouthSprites[index], MOUTH_BOX.x * SOURCE_SCALE, MOUTH_BOX.y * SOURCE_SCALE,
        MOUTH_BOX.w * SOURCE_SCALE, MOUTH_BOX.h * SOURCE_SCALE);
    });
    g.restore();
    drawBlink(EYES);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.translate(W / 2, H / 2);
    g.scale(sc, sc);
    g.translate(-cx, -cy);
    drawLights(ts);
  }

  function drawBlink(eyes) {
    if (blink <= 0) return;
    const rawProgress = blink > 0.5 ? (1 - blink) * 2 : blink * 2;
    const progress = rawProgress * rawProgress * (3 - 2 * rawProgress);
    eyes.forEach((eye, index) => {
      if (progress <= 0) return;
      const lidRx = eye.rx * 0.88;
      const lidRy = eye.ry * 0.82;
      const top = eye.y - lidRy;
      const width = lidRx * 2;
      const left = eye.x - lidRx;
      const bottom = eye.y + lidRy;
      g.save();
      g.beginPath();
      g.ellipse(eye.x, eye.y, lidRx, lidRy, 0, 0, Math.PI * 2);
      g.clip();
      const texture = simulationMode ? simulationEyelidTextures[index] : eyelidTextures[index];
      const upperEdgeY = top + lidRy * progress;
      const upperCurve = lidRy * 0.08 * progress;
      g.beginPath();
      g.moveTo(left + 2, top);
      g.lineTo(left + width - 2, top);
      g.lineTo(left + width - 2, upperEdgeY);
      g.quadraticCurveTo(eye.x, upperEdgeY + upperCurve, left + 2, upperEdgeY);
      g.closePath();
      g.clip();
      g.drawImage(texture.upper, left, top, width, lidRy);
      g.restore();

      g.save();
      g.beginPath();
      g.ellipse(eye.x, eye.y, lidRx, lidRy, 0, 0, Math.PI * 2);
      g.clip();
      const lowerEdgeY = bottom - lidRy * progress;
      const lowerCurve = lidRy * 0.08 * progress;
      g.beginPath();
      g.moveTo(left + 2, bottom);
      g.lineTo(left + width - 2, bottom);
      g.lineTo(left + width - 2, lowerEdgeY);
      g.quadraticCurveTo(eye.x, lowerEdgeY - lowerCurve, left + 2, lowerEdgeY);
      g.closePath();
      g.clip();
      g.drawImage(texture.lower, left, eye.y, width, lidRy);
      if (progress > 0.68) {
        g.strokeStyle = `rgba(52, 45, 38, ${(progress - 0.68) * 0.7})`;
        g.lineWidth = 0.7 + progress * 0.55;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(left + lidRx * 0.28, eye.y);
        g.quadraticCurveTo(eye.x, eye.y + lidRy * 0.1, left + width - lidRx * 0.28, eye.y);
        g.stroke();
      }
      g.restore();
    });
  }

  // warm halo while the child is heard, sparkles when Tombi is happy, a few drifting fireflies
  const sparks = [];
  const flies = Array.from({ length: 16 }, () => ({ x: 200 + Math.random() * 1650, y: 250 + Math.random() * 1300, p: Math.random() * 6.28, s: 5 + Math.random() * 6 }));
  function burst() {
    for (let i = 0; i < 46; i++) {
      const a = Math.random() * Math.PI * 2, v = 3 + Math.random() * 9;
      sparks.push({ x: 1090 + Math.cos(a) * 260, y: 820 + Math.sin(a) * 220, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 3, life: 1, s: 6 + Math.random() * 12 });
    }
  }
  function drawLights(ts, simulation = false) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    const lightLevel = simulation ? Math.max(glow, 0.26) : glow;
    if (lightLevel > 0.02) {
      const rg = g.createRadialGradient(1090, 880, 150, 1090, 880, 720);
      rg.addColorStop(0, `rgba(255,205,120,${0.22 * lightLevel})`);
      rg.addColorStop(1, 'rgba(255,205,120,0)');
      g.fillStyle = rg; g.fillRect(300, 100, 1600, 1600);
    }
    const t = ts / 1000;
    flies.forEach((f) => {
      f.x += Math.sin(t * 0.3 + f.p) * 0.5; f.y += Math.cos(t * 0.23 + f.p) * 0.4 - 0.15;
      if (f.y < 150) f.y = 1600;
      const a = 0.35 + 0.35 * Math.sin(t * 2 + f.p);
      const rg = g.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.s * 3);
      rg.addColorStop(0, `rgba(255,236,170,${a})`); rg.addColorStop(1, 'rgba(255,236,170,0)');
      g.fillStyle = rg; g.beginPath(); g.arc(f.x, f.y, f.s * 3, 0, 7); g.fill();
    });
    for (let i = sparks.length - 1; i >= 0; i--) {
      const p = sparks[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.12; p.vx *= 0.985; p.life -= 0.012;
      if (p.life <= 0) { sparks.splice(i, 1); continue; }
      const rg = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.s * 2.2);
      rg.addColorStop(0, `rgba(255,240,190,${p.life})`); rg.addColorStop(0.4, `rgba(255,200,90,${p.life * 0.6})`); rg.addColorStop(1, 'rgba(255,200,90,0)');
      g.fillStyle = rg; g.beginPath(); g.arc(p.x, p.y, p.s * 2.2, 0, 7); g.fill();
    }
    g.restore();
  }

  // ---------- voice ----------
  const voiceCfg = { voiceURI: '', rate: 0.95, pitch: 1.35, volume: 1 };
  let voices = [];
  function loadVoices() {
    if (!('speechSynthesis' in window)) return [];
    voices = speechSynthesis.getVoices().filter((v) => /^he|^iw/i.test(v.lang));
    return voices;
  }
  if ('speechSynthesis' in window) {
    loadVoices();
    speechSynthesis.onvoiceschanged = loadVoices;
  }
  const hasHebrewVoice = () => loadVoices().length > 0;

  let speakToken = 0;
  function stopSpeaking() {
    speakToken++;
    try { speechSynthesis.cancel(); } catch (e) {}
    if (currentClip) { try { currentClip.stop(); } catch (e) {} currentClip = null; }
    talking = false; analyser = null; wordTimed = false; talkWord = '';
    mouthDrive = 0; mouthDriveTarget = 0; mouthPulseShape = null; setMouthShape(0);
    T.audio.setGate(false);
  }
  let currentClip = null;

  async function playClip(blob, token) {
    const ctx = await T.audio.ensureCtx();
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    if (token !== speakToken) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const an = ctx.createAnalyser(); an.fftSize = 1024;
    src.connect(an); an.connect(ctx.destination);
    analyser = an; anaBuf = new Float32Array(an.fftSize);
    currentClip = src;
    await new Promise((r) => { src.onended = r; src.start(); });
    analyser = null; currentClip = null;
  }

  function tts(text, token) {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window) || !hasHebrewVoice()) {
        // no Hebrew voice: animate for about the time it would take to say it
        talking = true; talkPhase = 0;
        setTimeout(() => {
          talking = false; mouthDrive = 0; mouthDriveTarget = 0; wordTimed = false; setMouthShape(0); resolve();
        }, Math.min(9000, 600 + text.length * 70));
        return;
      }
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'he-IL';
      const v = voices.find((x) => x.voiceURI === voiceCfg.voiceURI) || voices[0];
      if (v) u.voice = v;
      u.rate = voiceCfg.rate; u.pitch = voiceCfg.pitch; u.volume = voiceCfg.volume;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true; talking = false; mouthDrive = 0; mouthDriveTarget = 0; wordTimed = false; talkWord = ''; setMouthShape(0);
        resolve();
      };
      u.onstart = () => { talking = true; talkPhase = 0; wordTimed = false; };
      u.onboundary = (event) => {
        const rest = text.slice(Number.isInteger(event.charIndex) ? event.charIndex : 0);
        const word = rest.match(/^[\u0590-\u05FFA-Za-z0-9]+/)?.[0];
        if (!word) return;
        talkWord = word;
        talkPhase = 0;
        talkWordDuration = Math.max(0.16, Math.min(0.65, Array.from(word).length * 0.075 / voiceCfg.rate));
        wordTimed = true;
        setMouthShape(1);
      };
      u.onend = finish; u.onerror = finish;
      setTimeout(finish, 2500 + text.length * 140); // Chrome sometimes never fires onend
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    });
  }

  // say(): recorded clip for this line if the therapist made one, else Hebrew TTS
  // lines are keyed by their text, so a recording replaces exactly that sentence
  async function say(text) {
    stopSpeaking();
    const token = speakToken;
    T.ui && T.ui.bubble(text);
    T.audio.setGate(true);
    rememberLine(text);
    try {
      const clip = T.voiceStore ? await T.voiceStore.get(text) : null;
      if (token !== speakToken) return;
      if (clip) await playClip(clip, token);
      else await tts(text, token);
    } finally {
      talking = false;
      // a short tail so the room echo does not count as the child
      await new Promise((r) => setTimeout(r, 280));
      if (token === speakToken) T.audio.setGate(false);
    }
  }

  function rememberLine(text) {
    if (!T.store) return;
    const st = T.store.settings;
    st.lines = st.lines || [];
    if (!st.lines.includes(text)) { st.lines.push(text); T.store.save(); }
  }

  // Tombi's "ba" for the rhythm stage: a short synthetic syllable with the mouth in sync
  async function ba(atMs = 0, strong = false) {
    const ctx = await T.audio.ensureCtx();
    const t = ctx.currentTime + atMs / 1000;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(strong ? 330 : 300, t);
    o.frequency.linearRampToValueAtTime(strong ? 300 : 270, t + 0.22);
    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 850; f1.Q.value = 3;
    const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1300; f2.Q.value = 4;
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(0, t);
    gn.gain.linearRampToValueAtTime(strong ? 0.9 : 0.7, t + 0.025);
    gn.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
    o.connect(f1).connect(gn); o.connect(f2).connect(gn); gn.connect(ctx.destination);
    o.start(t); o.stop(t + 0.3);
    setTimeout(() => pulseMouth(2, 160), atMs);
  }

  function drum(when, { low = false } = {}) {
    const ctx = T.audio.ctx;
    if (!ctx) return null;
    const t = Number.isFinite(when) ? when : ctx.currentTime + 0.05;
    const gain = ctx.createGain();
    const volume = soundSensitive ? 0.4 : 1;
    if (low) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(110, t);
      osc.frequency.exponentialRampToValueAtTime(58, t + 0.18);
      gain.gain.setValueAtTime(0.55 * volume, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.21);
    } else {
      const length = Math.ceil(ctx.sampleRate * 0.08);
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate), data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.012));
      const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter();
      source.buffer = buffer; filter.type = 'bandpass'; filter.frequency.value = 2200; filter.Q.value = 0.7;
      gain.gain.value = 0.65 * volume;
      source.connect(filter).connect(gain).connect(ctx.destination); source.start(t);
    }
    return t;
  }

  function bell(when) {
    const ctx = T.audio.ctx;
    if (!ctx) return null;
    const t = Number.isFinite(when) ? when : ctx.currentTime + 0.05;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'sine'; osc.frequency.value = 1046;
    gain.gain.setValueAtTime(0.0001, t); gain.gain.exponentialRampToValueAtTime(0.22, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    osc.connect(gain).connect(ctx.destination); osc.start(t); osc.stop(t + 0.3);
    return t;
  }

  function chirp(when) {
    const ctx = T.audio.ctx;
    if (!ctx) return null;
    const t = Number.isFinite(when) ? when : ctx.currentTime + 0.05;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'sine'; osc.frequency.setValueAtTime(3000, t); osc.frequency.linearRampToValueAtTime(4000, t + 0.02);
    gain.gain.setValueAtTime(0.0001, t); gain.gain.exponentialRampToValueAtTime(0.12, t + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.022);
    osc.connect(gain).connect(ctx.destination); osc.start(t); osc.stop(t + 0.025);
    return t;
  }

  async function hiss(ms = 1600) {
    const ctx = await T.audio.ensureCtx();
    const t = ctx.currentTime;
    const len = Math.ceil(ctx.sampleRate * ms / 1000);
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const s = ctx.createBufferSource(); s.buffer = b;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 4000;
    const gn = ctx.createGain(); gn.gain.setValueAtTime(0, t);
    gn.gain.linearRampToValueAtTime(0.25, t + 0.1); gn.gain.setValueAtTime(0.25, t + ms / 1000 - 0.15);
    gn.gain.linearRampToValueAtTime(0, t + ms / 1000);
    s.connect(f).connect(gn).connect(ctx.destination); s.start(t);
    talking = false; pulseMouth(1, ms);
    await new Promise((r) => setTimeout(r, ms));
  }

  function chime(kind = 'good') {
    const ctx = T.audio.ctx;
    if (!ctx) return;
    const notes = kind === 'good' ? [660, 880, 1320] : kind === 'end' ? [523, 659, 784, 1046] : [520];
    notes.forEach((hz, i) => {
      const t = ctx.currentTime + i * 0.11;
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = hz;
      const gn = ctx.createGain(); gn.gain.setValueAtTime(0.0001, t);
      gn.gain.exponentialRampToValueAtTime(0.25, t + 0.02); gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(gn).connect(ctx.destination); o.start(t); o.stop(t + 0.55);
    });
  }

  return {
    mount, resize, say, ba, drum, bell, chirp, hiss, chime, stopSpeaking, loadVoices, hasHebrewVoice, voiceCfg,
    happy() { hop = 1; burst(); },
    blinkNow() { blink = 1; },
    _blinkHold(v) { blinkHold = v; },
    force(v) { forced = v; },
    setMood(m) { mood = m; },
    setSimulationMode(v) { simulationMode = !!v; },
    setSoundSensitive(v) { soundSensitive = !!v; },
    get talking() { return talking; },
  };
})();

/* voiceStore — הקלטות של המטפלת לשורות של טומבי (לא של הילד), ב-IndexedDB של הדפדפן */
T.voiceStore = (() => {
  let dbp = null;
  const db = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('tombi-voice', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('clips');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => {
    try {
      const d = await db();
      return await new Promise((res, rej) => {
        const t = d.transaction('clips', mode);
        const req = fn(t.objectStore('clips'));
        t.oncomplete = () => res(req && req.result);
        t.onerror = () => rej(t.error);
      });
    } catch (e) { return null; }
  };
  return {
    get: (k) => tx('readonly', (s) => s.get(k)),
    put: (k, blob) => tx('readwrite', (s) => s.put(blob, k)),
    del: (k) => tx('readwrite', (s) => s.delete(k)),
    keys: () => tx('readonly', (s) => s.getAllKeys()),
  };
})();
