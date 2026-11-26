import { deepFreeze } from '../shared-piping-model/index.js';

export function projectPointToTarget(point, target) {
  // A straight two-port component (centre on its port-to-port line, e.g. a
  // pipe) carries the support anywhere along that line: project onto it.
  // Snapping to the centre put supports up to half a pipe length away.
  if (target.pointCanonical && target.startCanonical && target.endCanonical
      && onSegment(target.pointCanonical, target.startCanonical, target.endCanonical)) {
    return segmentProjection(point, target.startCanonical, target.endCanonical);
  }
  if (target.pointCanonical) return pointProjection(point, target.pointCanonical);
  if (target.startCanonical && target.endCanonical) {
    return segmentProjection(point, target.startCanonical, target.endCanonical);
  }
  return null;
}

export function targetAnchorPoint(target) {
  if (target.pointCanonical) return target.pointCanonical;
  if (!target.startCanonical || !target.endCanonical) return null;
  return deepFreeze({
    x: (target.startCanonical.x + target.endCanonical.x) / 2,
    y: (target.startCanonical.y + target.endCanonical.y) / 2,
    z: (target.startCanonical.z + target.endCanonical.z) / 2,
  });
}

function pointProjection(point, targetPoint) {
  return deepFreeze({
    projectedPointCanonical: targetPoint,
    distanceCanonical: distance(point, targetPoint),
    segmentParameter: null,
  });
}

function segmentProjection(point, start, end) {
  const vector = subtract(end, start);
  const denominator = dot(vector, vector);
  if (denominator === 0) return pointProjection(point, start);
  const parameter = clamp(dot(subtract(point, start), vector) / denominator);
  const projected = {
    x: start.x + vector.x * parameter,
    y: start.y + vector.y * parameter,
    z: start.z + vector.z * parameter,
  };
  return deepFreeze({
    projectedPointCanonical: deepFreeze(projected),
    distanceCanonical: distance(point, projected),
    segmentParameter: parameter,
  });
}

function subtract(left, right) {
  return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z };
}

function dot(left, right) {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function onSegment(point, start, end) {
  const length = distance(start, end);
  if (!(length > 0)) return false;
  return segmentProjection(point, start, end).distanceCanonical <= length * 1e-9;
}

function clamp(value) {
  return Math.max(0, Math.min(1, value));
}
