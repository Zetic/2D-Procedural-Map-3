export function mix32(x) {
  x >>>= 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

export function hashString(value) {
  const s = String(value);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return mix32(h);
}

export function hashParts(...parts) {
  let h = 0x811c9dc5;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0x9e3779b9;
    h = mix32(h);
  }
  return h >>> 0;
}

export function rand01(...parts) {
  return hashParts(...parts) / 4294967296;
}

export function randRange(min, max, ...parts) {
  return min + (max - min) * rand01(...parts);
}

export function randInt(min, max, ...parts) {
  return min + Math.floor(rand01(...parts) * (max - min + 1));
}

export function chance(probability, ...parts) {
  return rand01(...parts) < probability;
}

export function signed(magnitude, ...parts) {
  return (rand01(...parts) * 2 - 1) * magnitude;
}
