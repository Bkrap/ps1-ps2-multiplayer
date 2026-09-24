const BUTTONS = [
  ["Up", "DPadUp"],
  ["Right", "DPadRight"],
  ["Down", "DPadDown"],
  ["Left", "DPadLeft"],
  ["Triangle", "Y"],
  ["Circle", "B"],
  ["Cross", "A"],
  ["Square", "X"],
  ["Select", "Back"],
  ["Start", "Start"],
  ["L1", "LeftShoulder"],
  ["R1", "RightShoulder"],
  ["L2", "+LeftTrigger"],
  ["R2", "+RightTrigger"],
  ["L3", "LeftStick"],
  ["R3", "RightStick"],
  ["LLeft", "-LeftX"],
  ["LRight", "+LeftX"],
  ["LDown", "+LeftY"],
  ["LUp", "-LeftY"],
  ["RLeft", "-RightX"],
  ["RRight", "+RightX"],
  ["RDown", "+RightY"],
  ["RUp", "-RightY"],
  ["LargeMotor", "LargeMotor"],
  ["SmallMotor", "SmallMotor"],
];

export function parseSettingsIni(text) {
  const sections = {};
  let current = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    const section = line.match(/^\[(.+)\]$/);
    if (section) {
      current = section[1];
      sections[current] = {};
      continue;
    }
    if (!current) continue;
    const split = line.indexOf("=");
    if (split === -1) continue;
    sections[current][line.slice(0, split).trim()] = line.slice(split + 1).trim();
  }
  return sections;
}

export function assertPadIsolation(text) {
  const sections = parseSettingsIni(text);
  const errors = [];
  if (sections.GPU?.Renderer !== "Software") {
    errors.push("GPU.Renderer must be Software");
  }
  if (/Keyboard\//.test(text)) {
    errors.push("settings.ini must not bind the keyboard");
  }
  for (const [index, sectionName] of [["0", "Pad1"], ["1", "Pad2"]]) {
    const section = sections[sectionName];
    if (!section) {
      errors.push(`missing ${sectionName}`);
      continue;
    }
    if (section.Type !== "AnalogController") {
      errors.push(`${sectionName} must be an analog controller`);
    }
    for (const [key, control] of BUTTONS) {
      const expected = `SDL-${index}/${control}`;
      if (section[key] !== expected) {
        errors.push(`${sectionName}.${key} must be ${expected}`);
      }
    }
  }
  if (sections.Pad3?.Type !== "None" || sections.Pad4?.Type !== "None") {
    errors.push("Pad3 and Pad4 must stay disconnected");
  }
  const pad1 = JSON.stringify(sections.Pad1 || {});
  const pad2 = JSON.stringify(sections.Pad2 || {});
  if (pad1.includes("SDL-1/") || pad2.includes("SDL-0/")) {
    errors.push("Pad1 and Pad2 share a device");
  }
  return errors;
}

export function selkiesPermission(member) {
  // Pad 1 owns the Selkies primary display / encoder.
  // Pad 2 must also be role "controller" (not shared "viewer") so the browser
  // does not sit behind the shared-mode keyframe gate ("Waiting for stream...").
  // Server patch blocks slot>=2 from stealing the primary display.
  if (member.role === "player" && member.slot === 1) {
    return { role: "controller", slot: 1, mk_control: true };
  }
  if (member.role === "player") {
    return { role: "controller", slot: member.slot, mk_control: false };
  }
  return { role: "viewer", slot: null, mk_control: false };
}

export function selkiesTokenBody(members) {
  const body = {};
  for (const member of members) {
    body[member.token] = selkiesPermission(member);
  }
  return body;
}
