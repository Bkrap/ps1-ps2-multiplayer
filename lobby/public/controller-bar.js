/* DualShock live-test bar — native Gamepad API + optional gamepad.js assist. */
(function (global) {
  const FACE_INDEXES = [0, 1, 2, 3];
  const BUTTON_MAP = {
    0: "button_1",
    1: "button_2",
    2: "button_3",
    3: "button_4",
    4: "shoulder_top_left",
    5: "shoulder_top_right",
    6: "shoulder_bottom_left",
    7: "shoulder_bottom_right",
    8: "select",
    9: "start",
    10: "stick_button_left",
    11: "stick_button_right",
    12: "d_pad_up",
    13: "d_pad_down",
    14: "d_pad_left",
    15: "d_pad_right",
  };

  function diagramHtml() {
    return `
      <div class="ds-wrap" aria-hidden="true">
        <div class="ds-shoulders">
          <span data-pad="shoulder_bottom_left">L2</span>
          <span data-pad="shoulder_top_left">L1</span>
          <span data-pad="shoulder_top_right">R1</span>
          <span data-pad="shoulder_bottom_right">R2</span>
        </div>
        <div class="ds-body">
          <div class="ds-dpad">
            <span data-pad="d_pad_up">↑</span>
            <span data-pad="d_pad_left">←</span>
            <span data-pad="d_pad_right">→</span>
            <span data-pad="d_pad_down">↓</span>
          </div>
          <div class="ds-meta">
            <span data-pad="select">Select</span>
            <span data-pad="start">Start</span>
          </div>
          <div class="ds-face">
            <span data-pad="button_4" class="face tri">△</span>
            <span data-pad="button_3" class="face sq">□</span>
            <span data-pad="button_2" class="face cir">○</span>
            <span data-pad="button_1" class="face cro">×</span>
          </div>
        </div>
        <div class="ds-sticks">
          <span data-pad="stick_axis_left" class="stick">LS</span>
          <span data-pad="stick_button_left" class="l3">L3</span>
          <span data-pad="stick_axis_right" class="stick">RS</span>
          <span data-pad="stick_button_right" class="r3">R3</span>
        </div>
      </div>
    `;
  }

  function panelHtml({ slotLabel, spectator }) {
    if (spectator) {
      return `<section class="panel pad-panel" id="pad-panel">
        <h2 class="panel-title">Controller</h2>
        <p class="hint">You are watching. Your pad is ignored.</p>
      </section>`;
    }
    return `<section class="panel pad-panel controller-bar" id="pad-panel">
      <div class="controller-bar-head">
        <h2 class="panel-title">Controller · ${slotLabel}</h2>
        <p class="pad-status" id="pad-status" role="status">Click Arm pad, then press a button on your physical controller.</p>
      </div>
      <p class="hint">Physical pad only (USB / Bluetooth). The diagram lights up when the browser sees input — tapping the diagram does nothing.</p>
      <div class="actions">
        <button type="button" id="arm-pad">Arm pad</button>
      </div>
      ${diagramHtml()}
      <ul class="pad-checklist" id="pad-checklist">
        <li data-check="armed">Armed</li>
        <li data-check="connected">Pad connected</li>
        <li data-check="face">Face button</li>
        <li data-check="stick">Stick</li>
      </ul>
      <p class="pad-device" id="pad-device"></p>
    </section>`;
  }

  function createControllerBar({ onReadyChange } = {}) {
    let seen = { armed: false, connected: false, face: false, stick: false, id: "" };
    let destroyed = false;
    let raf = null;
    let activeIndex = null;
    let lit = new Set();

    function setLit(key, on) {
      if (on) lit.add(key);
      else lit.delete(key);
      document.querySelectorAll(`[data-pad="${key}"]`).forEach((el) => {
        el.classList.toggle("lit", on);
      });
    }

    function clearLits() {
      [...lit].forEach((key) => setLit(key, false));
    }

    function setCheck(key, on) {
      const el = document.querySelector(`[data-check="${key}"]`);
      if (el) el.classList.toggle("done", on);
    }

    function publish() {
      const ready = seen.connected && seen.face && seen.stick;
      setCheck("armed", seen.armed);
      setCheck("connected", seen.connected);
      setCheck("face", seen.face);
      setCheck("stick", seen.stick);
      const status = document.querySelector("#pad-status");
      const device = document.querySelector("#pad-device");
      if (status) {
        if (!seen.armed) status.textContent = "Click Arm pad, then press a button on your physical controller.";
        else if (!seen.connected) {
          status.textContent = "Armed — press any button on the pad now. Use Chrome/Edge on the machine with the pad (not a phone, not an in-IDE preview).";
        } else if (!ready) status.textContent = "Move a stick and press × ○ □ or △.";
        else status.textContent = "Ready. Click Focus stream before you play.";
      }
      if (device) device.textContent = seen.id || "";
      if (typeof onReadyChange === "function") onReadyChange(ready, seen);
    }

    function readPads() {
      if (!navigator.getGamepads) return [];
      return [...navigator.getGamepads()].filter(Boolean);
    }

    function tick() {
      if (destroyed) return;
      const pads = readPads();
      if (!pads.length) {
        if (seen.connected) {
          seen.connected = false;
          seen.id = "";
          activeIndex = null;
          clearLits();
          publish();
        }
        raf = requestAnimationFrame(tick);
        return;
      }

      let pad = activeIndex != null ? pads.find((p) => p.index === activeIndex) : null;
      if (!pad) {
        pad = pads.find((p) => p.buttons.some((b) => b.pressed) || p.axes.some((a) => Math.abs(a) > 0.35)) || pads[0];
        activeIndex = pad.index;
      }

      if (!seen.connected || seen.id !== pad.id) {
        seen.connected = true;
        seen.id = pad.id;
        publish();
      }

      const nextLit = new Set();
      pad.buttons.forEach((button, index) => {
        const key = BUTTON_MAP[index];
        if (!key) return;
        if (button.pressed || button.value > 0.5) {
          nextLit.add(key);
          if (FACE_INDEXES.includes(index)) seen.face = true;
        }
      });
      const leftStick = Math.hypot(pad.axes[0] || 0, pad.axes[1] || 0) > 0.35;
      const rightStick = Math.hypot(pad.axes[2] || 0, pad.axes[3] || 0) > 0.35;
      if (leftStick) {
        nextLit.add("stick_axis_left");
        seen.stick = true;
      }
      if (rightStick) {
        nextLit.add("stick_axis_right");
        seen.stick = true;
      }

      Object.values(BUTTON_MAP).concat(["stick_axis_left", "stick_axis_right"]).forEach((key) => {
        setLit(key, nextLit.has(key));
      });

      publish();
      raf = requestAnimationFrame(tick);
    }

    function arm() {
      seen.armed = true;
      // Calling getGamepads inside the click handler unlocks the API in Chromium.
      const pads = readPads();
      const ua = navigator.userAgent;
      const isCursor = /Cursor/i.test(ua) || Boolean(global.cursor) || /Electron/i.test(ua);
      if (pads.length) {
        seen.connected = true;
        seen.id = pads[0].id;
        activeIndex = pads[0].index;
      }
      publish();
      if (!raf) raf = requestAnimationFrame(tick);

      // Probe WebHID: proves OS visibility even when Gamepad API is empty.
      if (navigator.hid && typeof navigator.hid.requestDevice === "function") {
        navigator.hid.requestDevice({
          filters: [
            { usagePage: 0x01, usage: 0x05 },
            { usagePage: 0x01, usage: 0x04 },
            { vendorId: 0x054c },
            { vendorId: 0x045e },
            { vendorId: 0x057e },
          ],
        }).then((devices) => {
          const status = document.querySelector("#pad-status");
          if (!pads.length && status) {
            if (devices.length) {
              status.textContent = `Chrome’s Gamepad API sees 0 pads, but WebHID sees “${devices[0].productName || "a device"}”. Use Firefox for this pad, or close Steam and try a wired USB connection in Chrome.`;
            } else {
              status.textContent = "No pad in this browser. Firefox works with many pads Chrome misses on Mac — open http://127.0.0.1:8791 in Firefox, or use wired USB and quit Steam in Chrome.";
            }
          }
        }).catch((err) => {
          const status = document.querySelector("#pad-status");
          if (!pads.length && status) {
            status.textContent = `Gamepad API sees 0 pads. WebHID: ${String(err && err.message || err)}. Use Chrome/Edge (outside Cursor), close Steam, then Arm pad again.`;
          }
        });
      } else if (!pads.length) {
        const status = document.querySelector("#pad-status");
        if (status) {
          status.textContent = isCursor
            ? "This window looks like an in-IDE browser — gamepads usually do not work here. Open http://127.0.0.1:8791 in Chrome or Edge."
            : "This browser reports 0 gamepads. Open in Chrome/Edge, close Steam, ensure the pad is paired to this Mac.";
        }
      }
    }

    function bind() {
      const armBtn = document.querySelector("#arm-pad");
      if (armBtn) armBtn.addEventListener("click", arm);
      window.addEventListener("gamepadconnected", (ev) => {
        if (!seen.armed) return;
        seen.connected = true;
        seen.id = ev.gamepad.id;
        activeIndex = ev.gamepad.index;
        publish();
        if (!raf) raf = requestAnimationFrame(tick);
      });
      publish();
    }

    function destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = null;
    }

    function isReady() {
      return seen.connected && seen.face && seen.stick;
    }

    return { bind, destroy, isReady };
  }

  global.Ps1ControllerBar = { createControllerBar, panelHtml, diagramHtml };
})(window);
