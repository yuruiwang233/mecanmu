/* ============================================================
 * ESP32-S3 麦轮小车遥控 — 前端逻辑
 *
 * 电机命名（俯视）：
 *   L1 = 左前    R1 = 右前
 *   L2 = 左后    R2 = 右后
 *
 * BLE 协议：
 *   手机模式：F B L R S TL TR / V<speed>
 *   手柄模式：M<L1>,<R1>,<L2>,<R2>   （-255~255）
 * ============================================================ */

const SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const CHARACTERISTIC_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";

// ==================== DOM ====================
const connectButton = document.querySelector("#connectButton");
const statusDot = document.querySelector("#statusDot");
const statusText = document.querySelector("#statusText");
const lastCommand = document.querySelector("#lastCommand");
const speedSlider = document.querySelector("#speedSlider");
const speedValue = document.querySelector("#speedValue");
const controlButtons = [...document.querySelectorAll("[data-command]")];

let device;
let commandCharacteristic;
let activeKeyCommand = null;

// ==================== 指令映射 ====================
const commandNames = {
  F: "前进", B: "后退", L: "左移", R: "右移", S: "停止",
  TL: "原地左转", TR: "原地右转", C: "绕左前轮画圆",
};

const keyCommands = {
  ArrowUp: "F", KeyW: "F",
  ArrowDown: "B", KeyS: "B",
  ArrowLeft: "L", KeyA: "L",
  ArrowRight: "R", KeyD: "R",
  Space: "S",
};

// ==================== BLE 连接 ====================
function setConnectionState(connected, text) {
  statusDot.classList.toggle("connected", connected);
  statusText.textContent = text;
  connectButton.textContent = connected ? "断开连接" : "连接蓝牙";
}

function setControlsEnabled(enabled) {
  controlButtons.forEach((btn) => { btn.disabled = !enabled; });
}

function setActiveCommand(command) {
  controlButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.command === command);
  });
}

async function sendMessage(message) {
  if (!commandCharacteristic) {
    lastCommand.textContent = "请先连接蓝牙";
    return;
  }
  const data = new TextEncoder().encode(message);
  await commandCharacteristic.writeValue(data);
}

async function sendCommand(command) {
  try {
    await sendMessage(command + "\n");
    lastCommand.textContent = `已发送：${commandNames[command] ?? command}`;
    setActiveCommand(command === "S" ? null : command);
  } catch (err) {
    lastCommand.textContent = `发送失败：${err.message}`;
  }
}

async function sendSpeed(value) {
  speedValue.value = value;
  speedValue.textContent = value;
  try {
    await sendMessage(`V${value}\n`);
    lastCommand.textContent = `速度：${value}`;
  } catch {
    if (commandCharacteristic) lastCommand.textContent = "速度发送失败";
  }
}

function onDisconnected() {
  commandCharacteristic = null;
  setControlsEnabled(false);
  setActiveCommand(null);
  setConnectionState(false, "已断开");
}

async function connectBluetooth() {
  if (!navigator.bluetooth) {
    statusText.textContent = "当前浏览器不支持 Web Bluetooth";
    lastCommand.textContent = "请使用 Chrome / Edge，通过 localhost/HTTPS 打开";
    return;
  }
  if (device?.gatt?.connected) { device.gatt.disconnect(); return; }

  try {
    setConnectionState(false, "正在选择设备...");
    device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [SERVICE_UUID],
    });
    device.addEventListener("gattserverdisconnected", onDisconnected);

    setConnectionState(false, "正在连接...");
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    commandCharacteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);

    setConnectionState(true, `已连接：${device.name || "ESP32-S3"}`);
    setControlsEnabled(true);
    await sendSpeed(speedSlider.value);
    await sendCommand("S");
  } catch (err) {
    commandCharacteristic = null;
    setControlsEnabled(false);
    setConnectionState(false, "连接失败");
    lastCommand.textContent = err.message;
  }
}

connectButton.addEventListener("click", connectBluetooth);

// ==================== 长按持续发送 ====================
let holdTimer = null;
let heldCmd = null;
const HOLD_REPEAT_MS = 300;   // 长按期间每 300ms 重发一次，喂饱看门狗

function startHold(cmd, evt) {
  if (heldCmd === cmd) return;
  stopHold();                  // 先结束上一个长按
  heldCmd = cmd;
  // 捕获指针，手指轻微移出按钮也不中断
  if (evt && evt.target && evt.target.setPointerCapture &&
      evt.pointerId !== undefined) {
    try { evt.target.setPointerCapture(evt.pointerId); } catch {}
  }
  sendCommand(cmd);
  if (cmd !== "S") {
    holdTimer = setInterval(() => sendCommand(cmd), HOLD_REPEAT_MS);
  }
}

function stopHold() {
  if (holdTimer) { clearInterval(holdTimer); holdTimer = null; }
  const cmd = heldCmd;
  heldCmd = null;
  if (cmd && cmd !== "S") sendCommand("S");
}

// ==================== 手机按钮 ====================
controlButtons.forEach((button) => {
  const cmd = button.dataset.command;

  button.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    startHold(cmd, e);
  });
  button.addEventListener("pointerup", (e) => {
    e.preventDefault();
    stopHold();
  });
  button.addEventListener("pointercancel", () => stopHold());
});

// 兜底：指针在按钮外松开也能停止
window.addEventListener("pointerup", () => { if (heldCmd) stopHold(); });
window.addEventListener("pointercancel", () => { if (heldCmd) stopHold(); });

speedSlider.addEventListener("input", () => {
  speedValue.textContent = speedSlider.value;
});
speedSlider.addEventListener("change", () => {
  sendSpeed(speedSlider.value);
});

// ==================== 键盘 ====================
window.addEventListener("keydown", (e) => {
  const cmd = keyCommands[e.code];
  if (!cmd) return;
  e.preventDefault();
  if (heldCmd === cmd) return;   // 系统按键自动重复，忽略
  startHold(cmd);
});
window.addEventListener("keyup", (e) => {
  const cmd = keyCommands[e.code];
  if (!cmd) return;
  e.preventDefault();
  if (heldCmd === cmd) stopHold();
});

setControlsEnabled(false);

/* ============================================================
 * 手柄遥控
 * ============================================================ */
const DEADZONE = 0.18;        // 进入控制的死区
const EXIT_ZONE = 0.12;       // 退出控制的迟滞阈值（小于死区，防抖）
const MAX_PWM = 255;
const ROT_FACTOR = 1.0;      // B/X 原地转圈速度（0~1），全速最灵敏

// ---- 绕 L1（左前）画圆 ----
// 几何：前后半轴 a=0.46，左右半轴 b=0.54（归一化 a+b=1）
// 四轮归一化（对角轮 R2 最快，设为 1），L1 定点为 0
const CIRCLE_FACTOR = 0.8;   // 画圆整体速度（0~1），慢一点定点更稳
const CIRCLE_WHEELS = { l1: 0.0, r1: 0.54, l2: -0.46, r2: 1.0 };

// 摇杆平滑状态（指数滤波，消除静止抖动）
const stickSmooth = {
  lx: 0, ly: 0, rx: 0, ry: 0,
};
let leftActive = false;       // 左摇杆迟滞状态
let ltActive = false;         // LT 前进油门迟滞状态
let rtActive = false;         // RT 倒车油门迟滞状态

// ---- 手柄图形 SVG ----
const gpLeftStick = document.querySelector("#gp-left-stick");
const gpRightStick = document.querySelector("#gp-right-stick");
const gpLtFill = document.querySelector("#gp-lt-fill");
const gpRtFill = document.querySelector("#gp-rt-fill");

const gpButtons = {
  y: document.querySelector("#gp-btn-y"),
  x: document.querySelector("#gp-btn-x"),
  b: document.querySelector("#gp-btn-b"),
  a: document.querySelector("#gp-btn-a"),
  lb: document.querySelector("#gp-lb"),
  rb: document.querySelector("#gp-rb"),
  dpad: document.querySelector("#gp-dpad"),
};

// ---- 摇杆圆盘 ----
const padSticks = {
  L: {
    accent: "#0f766e", stroke: "#0d9488",
    dot: document.querySelector("#padL-dot"),
    ray: document.querySelector("#padL-ray"),
    arc: document.querySelector("#padL-arc"),
    angle: document.querySelector("#padL-angle"),
    mag: document.querySelector("#padL-mag"),
    x: document.querySelector("#padL-x"),
    y: document.querySelector("#padL-y"),
  },
  R: {
    accent: "#1d4ed8", stroke: "#3b82f6",
    dot: document.querySelector("#padR-dot"),
    ray: document.querySelector("#padR-ray"),
    arc: document.querySelector("#padR-arc"),
    angle: document.querySelector("#padR-angle"),
    mag: document.querySelector("#padR-mag"),
    x: document.querySelector("#padR-x"),
    y: document.querySelector("#padR-y"),
  },
};

// ---- 状态显示 ----
const modeButtons = [...document.querySelectorAll(".mode-btn")];
const phoneView = document.querySelector("#phoneView");
const padView = document.querySelector("#padView");
const padDot = document.querySelector("#padDot");
const padStatusText = document.querySelector("#padStatusText");
const padInfo = document.querySelector("#padInfo");
const padSource = document.querySelector("#padSource");
const padL1 = document.querySelector("#padL1");
const padR1 = document.querySelector("#padR1");
const padL2 = document.querySelector("#padL2");
const padR2 = document.querySelector("#padR2");
const padLTFill = document.querySelector("#padLT-fill");
const padLTVal = document.querySelector("#padLT-val");
const padRTFill = document.querySelector("#padRT-fill");
const padRTVal = document.querySelector("#padRT-val");

// ---- 按键 chips ----
const BTN_CHIPS = [
  ["A", 0], ["B", 1], ["X", 2], ["Y", 3],
  ["LB", 4], ["RB", 5], ["L3", 10], ["R3", 11],
];
const padChips = BTN_CHIPS.map(([name, idx]) => {
  const el = document.createElement("span");
  el.className = "chip";
  el.textContent = name;
  document.querySelector("#padButtons").appendChild(el);
  return { idx, el };
});

// ---- 状态变量 ----
let currentMode = "phone";
let padLoopId = null;
let lastDriveMsg = null;
let padCharSeen = false;
let lastSentMs = 0;

// ==================== 模式切换 ====================
function switchMode(mode) {
  if (mode === currentMode) return;
  currentMode = mode;
  stopHold();   // 清理手机模式可能残留的长按
  modeButtons.forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === mode);
  });
  phoneView.hidden = mode !== "phone";
  padView.hidden = mode !== "pad";

  if (mode === "pad") {
    lastDriveMsg = null;
    padLoopId = requestAnimationFrame(padTick);
  } else {
    if (padLoopId) cancelAnimationFrame(padLoopId);
    padLoopId = null;
    if (commandCharacteristic) sendCommand("S");
  }
}
modeButtons.forEach((b) => {
  b.addEventListener("click", () => switchMode(b.dataset.mode));
});

// 手柄模式屏蔽键盘手机指令
window.addEventListener("keydown", (e) => {
  if (currentMode === "pad") e.stopImmediatePropagation();
}, true);
window.addEventListener("keyup", (e) => {
  if (currentMode === "pad") e.stopImmediatePropagation();
}, true);

// ==================== 工具函数 ====================
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function triggerValue(gp, axisIdx, btnIdx) {
  const axis = gp.axes[axisIdx] ?? 0;
  const btn = gp.buttons[btnIdx] ? gp.buttons[btnIdx].value : 0;
  return clamp(Math.max(axis, btn), 0, 1);
}

/* 保存 SVG 原始描边色 */
function saveOrigStrokes(root) {
  if (!root) return;
  root.querySelectorAll("circle, rect, path").forEach((node) => {
    if (!node.dataset.origStroke)
      node.dataset.origStroke = node.getAttribute("stroke") || "#c9d1d9";
  });
}
Object.values(gpButtons).forEach((el) => saveOrigStrokes(el));

/* 高亮手柄图形按钮 */
function highlightGpButton(el, on) {
  if (!el) return;
  el.setAttribute("opacity", on ? "1" : "0.55");
  el.querySelectorAll("circle, rect, path").forEach((node) => {
    node.setAttribute("stroke", on ? "#f97316" : (node.dataset.origStroke || "#c9d1d9"));
  });
  el.querySelectorAll("text").forEach((node) => {
    node.setAttribute("fill", on ? "#f97316" : "#c9d1d9");
  });
}

// ==================== 摇杆圆盘渲染 ====================
function updatePadStick(stick, xRaw, yRaw) {
  const x = clamp(xRaw, -1, 1);
  const y = clamp(yRaw, -1, 1);
  const mag = Math.min(1, Math.hypot(x, y));
  const inDead = mag <= DEADZONE;
  let deg = 0;
  if (mag > 0.0005) {
    deg = (Math.atan2(-y, x) * 180) / Math.PI;
    if (deg < 0) deg += 360;
  }

  const cx = 120, cy = 120, R = 92;
  stick.dot.setAttribute("cx", cx + x * R);
  stick.dot.setAttribute("cy", cy + y * R);
  stick.dot.setAttribute("fill", inDead ? "#b6c2cf" : stick.accent);
  stick.dot.setAttribute("stroke", inDead ? "#cbd5e1" : stick.stroke);

  const a = (deg * Math.PI) / 180;
  const ex = cx + R * Math.cos(a);
  const ey = cy - R * Math.sin(a);
  stick.ray.setAttribute("x2", ex.toFixed(2));
  stick.ray.setAttribute("y2", ey.toFixed(2));
  stick.arc.setAttribute("d",
    `M ${cx + R} ${cy} A ${R} ${R} 0 ${deg > 180 ? 1 : 0} 0 ${ex.toFixed(2)} ${ey.toFixed(2)}`);
  stick.ray.style.opacity = inDead ? 0.3 : 0.85;
  stick.arc.style.opacity = !inDead && mag > 0.02 ? 0.25 : 0;

  stick.angle.textContent = `${deg.toFixed(1)}°`;
  stick.mag.textContent = `${Math.round(mag * 100)}%`;
  stick.x.textContent = x.toFixed(2);
  stick.y.textContent = y.toFixed(2);
}

// ==================== 手柄图形摇杆十字 ====================
function updateGpStick(group, cx, cy, x, y, range) {
  const dx = x * range, dy = y * range;
  const nodes = group.querySelectorAll("line, circle");
  // 横线
  nodes[0].setAttribute("x1", cx - 12 + dx);
  nodes[0].setAttribute("x2", cx + 12 + dx);
  nodes[0].setAttribute("y1", cy + dy);
  nodes[0].setAttribute("y2", cy + dy);
  // 竖线
  nodes[1].setAttribute("x1", cx + dx);
  nodes[1].setAttribute("x2", cx + dx);
  nodes[1].setAttribute("y1", cy - 12 + dy);
  nodes[1].setAttribute("y2", cy + 12 + dy);
  // 中心点
  nodes[2].setAttribute("cx", cx + dx);
  nodes[2].setAttribute("cy", cy + dy);
}

// ==================== 麦轮运动学 ====================
/* vx: 前+, vy: 左+, w: 逆时针+
 *
 * L1 = vx - vy - w    R1 = vx + vy + w
 * L2 = vx + vy - w    R2 = vx - vy + w
 */
function mecanumKinematics(vx, vy, w) {
  let l1 = vx - vy - w;
  let r1 = vx + vy + w;
  let l2 = vx + vy - w;
  let r2 = vx - vy + w;

  const peak = Math.max(Math.abs(l1), Math.abs(r1), Math.abs(l2), Math.abs(r2), 1);
  l1 /= peak; r1 /= peak; l2 /= peak; r2 /= peak;
  return { l1, r1, l2, r2 };
}

// ==================== 手柄 → 麦轮驱动 ====================
function computePadDrive(gp) {
  // 原始轴值
  const rawLx = gp.axes[0] || 0;
  const rawLy = gp.axes[1] || 0;
  const rawRx = gp.axes[2] || 0;
  const rawRy = gp.axes[3] || 0;

  // 指数平滑（静止时快速归零，移动时跟手）
  const SMOOTH = 0.55;
  stickSmooth.lx = SMOOTH * rawLx + (1 - SMOOTH) * stickSmooth.lx;
  stickSmooth.ly = SMOOTH * rawLy + (1 - SMOOTH) * stickSmooth.ly;
  stickSmooth.rx = SMOOTH * rawRx + (1 - SMOOTH) * stickSmooth.rx;
  stickSmooth.ry = SMOOTH * rawRy + (1 - SMOOTH) * stickSmooth.ry;

  const lx = stickSmooth.lx, ly = stickSmooth.ly;
  const rx = stickSmooth.rx, ry = stickSmooth.ry;
  const lt = triggerValue(gp, 4, 6);   // 左扳机：前进油门
  const rt = triggerValue(gp, 5, 7);   // 右扳机：倒车油门

  const lMag = Math.hypot(lx, ly);
  // 迟滞：未激活时用 DEADZONE 进入，激活后用 EXIT_ZONE 退出
  if (leftActive && lMag < EXIT_ZONE) leftActive = false;
  if (!leftActive && lMag > DEADZONE) leftActive = true;

  let vx = 0, vy = 0, rot = 0, source = "none";
  let direct = null;   // 特殊动作直接指定四轮归一化值

  // ---- B / X 原地转圈，Y 绕 L1 画圆（优先级最高）----
  const btnB = !!gp.buttons[1]?.pressed;   // B = 向右原地转圈
  const btnX = !!gp.buttons[2]?.pressed;   // X = 向左原地转圈
  const btnY = !!gp.buttons[3]?.pressed;   // Y = 绕 L1 画圆
  if (btnB) {
    rot = -ROT_FACTOR;     // 顺时针 → 右转
    source = "rotate-r";
  } else if (btnX) {
    rot = ROT_FACTOR;      // 逆时针 → 左转
    source = "rotate-l";
  } else if (btnY) {
    direct = CIRCLE_WHEELS;
    source = "circle";
  }

  if (source === "none") {
    if (leftActive) {
      // ---- 模式一：左摇杆 = 方向 + 速度 ----
      vx = -ly;
      vy = -lx;
      vx = (vx / lMag) * Math.min(1, lMag);
      vy = (vy / lMag) * Math.min(1, lMag);
      source = "left";
    } else {
      // LT / RT 迟滞
      if (ltActive && lt < 0.02) ltActive = false;
      if (!ltActive && lt > 0.05) ltActive = true;
      if (rtActive && rt < 0.02) rtActive = false;
      if (!rtActive && rt > 0.05) rtActive = true;

      if (ltActive || rtActive) {
        // ---- 模式二：LT 前进 / RT 倒车，右摇杆 = 方向 ----
        // 净油门：LT 为 +（前进），RT 为 −（倒车），同按相互抵消
        const throttle = lt - rt;
        const rMag = Math.hypot(rx, ry);

        // 右摇杆指向的单位方向；居中时默认正前 / 正后
        let dirX = 1, dirY = 0;
        if (rMag > DEADZONE) {
          dirX = -ry / rMag;   // 摇杆上推 → 前方
          dirY = -rx / rMag;   // 摇杆左推 → 左方
        }
        // throttle 为负时方向自动取反（倒车）
        vx = clamp(dirX * throttle, -1, 1);
        vy = clamp(dirY * throttle, -1, 1);
        source = "lt-right";
      }
    }
  }

  // 绕 L1 画圆：直接输出固定四轮模式（L1 不动）
  if (direct) {
    return {
      l1: Math.round(direct.l1 * CIRCLE_FACTOR * MAX_PWM),
      r1: Math.round(direct.r1 * CIRCLE_FACTOR * MAX_PWM),
      l2: Math.round(direct.l2 * CIRCLE_FACTOR * MAX_PWM),
      r2: Math.round(direct.r2 * CIRCLE_FACTOR * MAX_PWM),
      source,
    };
  }

  const w = mecanumKinematics(vx, vy, rot);
  return {
    l1: Math.round(w.l1 * MAX_PWM),
    r1: Math.round(w.r1 * MAX_PWM),
    l2: Math.round(w.l2 * MAX_PWM),
    r2: Math.round(w.r2 * MAX_PWM),
    source,
  };
}

// ==================== 发送四轮驱动 ====================
const KEEPALIVE_MS = 200;   // 数值不变时也定时重发，喂饱看门狗，保证持续动作

function sendDrive(l1, r1, l2, r2) {
  if (!commandCharacteristic) return;
  const now = performance.now();
  const msg = `M${l1},${r1},${l2},${r2}\n`;
  const changed = msg !== lastDriveMsg;
  // 变化的指令最多等 30ms（触发灵敏）；不变的指令按 keepalive 周期重发
  const wait = changed ? 30 : KEEPALIVE_MS;
  if (now - lastSentMs < wait) return;
  lastDriveMsg = msg;
  lastSentMs = now;
  sendMessage(msg).catch(() => {});
}

// ==================== 复位所有控件 ====================
function resetPadWidgets() {
  updatePadStick(padSticks.L, 0, 0);
  updatePadStick(padSticks.R, 0, 0);
  padLTFill.style.width = "0%";
  padLTVal.textContent = "0.00";
  padRTFill.style.width = "0%";
  padRTVal.textContent = "0.00";
  padChips.forEach((c) => c.el.classList.remove("on"));
  padL1.textContent = "0"; padR1.textContent = "0";
  padL2.textContent = "0"; padR2.textContent = "0";

  updateGpStick(gpLeftStick, 240, 225, 0, 0, 20);
  updateGpStick(gpRightStick, 560, 310, 0, 0, 20);
  gpLtFill.setAttribute("height", "0");
  gpLtFill.setAttribute("y", "44");
  gpRtFill.setAttribute("height", "0");
  gpRtFill.setAttribute("y", "96");
}

// ==================== 手柄主循环 ====================
function padTick() {
  let gp = null;
  if (navigator.getGamepads) {
    for (const p of navigator.getGamepads()) {
      if (p && p.connected) { gp = p; break; }
    }
  }

  // BLE 重连后强制刷新
  if (commandCharacteristic && !padCharSeen) {
    padCharSeen = true;
    lastDriveMsg = null;
  }
  if (!commandCharacteristic) padCharSeen = false;

  if (!gp) {
    // 复位滤波与迟滞状态
    stickSmooth.lx = 0; stickSmooth.ly = 0;
    stickSmooth.rx = 0; stickSmooth.ry = 0;
    leftActive = false; ltActive = false; rtActive = false;

    padDot.classList.remove("on");
    padStatusText.textContent = "未检测到手柄";
    padInfo.textContent = "连接手柄后按任意键激活（需 Chrome / Edge 前台）";
    padSource.textContent = "无输入";
    padSource.classList.remove("live");
    resetPadWidgets();
    if (commandCharacteristic) sendDrive(0, 0, 0, 0);
  } else {
    padDot.classList.add("on");
    padStatusText.textContent = `已连接：${gp.id}`;
    padInfo.textContent = `mapping: ${gp.mapping || "none"} · index ${gp.index}`;

    const lx = gp.axes[0] || 0, ly = gp.axes[1] || 0;
    const rx = gp.axes[2] || 0, ry = gp.axes[3] || 0;

    // 摇杆圆盘
    updatePadStick(padSticks.L, lx, ly);
    updatePadStick(padSticks.R, rx, ry);
    // 手柄图形十字
    updateGpStick(gpLeftStick, 240, 225, lx, ly, 20);
    updateGpStick(gpRightStick, 560, 310, rx, ry, 20);

    // LT / RT
    const lt = triggerValue(gp, 4, 6);
    const rt = triggerValue(gp, 5, 7);
    padLTFill.style.width = `${(lt * 100).toFixed(1)}%`;
    padLTVal.textContent = lt.toFixed(2);
    padRTFill.style.width = `${(rt * 100).toFixed(1)}%`;
    padRTVal.textContent = rt.toFixed(2);

    // 手柄图形扳机填充
    gpLtFill.setAttribute("height", (lt * 52).toFixed(1));
    gpLtFill.setAttribute("y", "44");
    gpRtFill.setAttribute("height", (rt * 52).toFixed(1));
    gpRtFill.setAttribute("y", (96 - rt * 52).toFixed(1));

    // 按键高亮
    highlightGpButton(gpButtons.y, !!(gp.buttons[3]?.pressed));
    highlightGpButton(gpButtons.x, !!(gp.buttons[2]?.pressed));
    highlightGpButton(gpButtons.b, !!(gp.buttons[1]?.pressed));
    highlightGpButton(gpButtons.a, !!(gp.buttons[0]?.pressed));
    highlightGpButton(gpButtons.lb, !!(gp.buttons[4]?.pressed));
    highlightGpButton(gpButtons.rb, !!(gp.buttons[5]?.pressed));

    // D-pad: 12上 13下 14左 15右
    const dpadOn = [12, 13, 14, 15].some((i) => gp.buttons[i]?.pressed);
    highlightGpButton(gpButtons.dpad, dpadOn);

    // chips
    padChips.forEach((c) => {
      c.el.classList.toggle("on", !!gp.buttons[c.idx]?.pressed);
    });

    // 驱动计算
    const drive = computePadDrive(gp);
    padSource.textContent =
      drive.source === "circle" ? "Y 按住：绕左前轮 L1 画圆中"
      : drive.source === "rotate-l" ? "X 按住：向左原地转圈中"
      : drive.source === "rotate-r" ? "B 按住：向右原地转圈中"
      : drive.source === "left" ? "左摇杆全向操控中"
      : drive.source === "lt-right" ? "LT前进 / RT倒车 + 右摇杆方向"
      : "无输入";
    padSource.classList.toggle("live", drive.source !== "none");
    padL1.textContent = drive.l1;
    padR1.textContent = drive.r1;
    padL2.textContent = drive.l2;
    padR2.textContent = drive.r2;

    if (commandCharacteristic)
      sendDrive(drive.l1, drive.r1, drive.l2, drive.r2);
  }

  padLoopId = requestAnimationFrame(padTick);
}

if (location.hash === "#pad") switchMode("pad");
