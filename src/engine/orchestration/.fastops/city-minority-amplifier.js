// City Minority Amplifier - Scaled Deliberation
// Amplifies minority positions to prevent echo chambers in collective intelligence

const { EventEmitter } = require('events');

class MinorityAmplifier extends EventEmitter {
  constructor(options = {}) {
    super();
    this.threshold = options.threshold || 0.3; // 30% minority threshold
    this.amplificationFactor = options.amplificationFactor || 2.0;
    this.positions = new Map();
    this.amplifiedPositions = new Set();
  }

  recordPosition(positionId, supportCount, totalCount) {
    const supportRatio = supportCount / totalCount;
    const isMinority = supportRatio < this.threshold;
    
    this.positions.set(positionId, {
      supportRatio,
      isMinority,
      supportCount,
      totalCount,
      originalWeight: supportCount
    });

    if (isMinority && !this.amplifiedPositions.has(positionId)) {
      this.amplifyPosition(positionId);
    }
  }

  amplifyPosition(positionId) {
    const position = this.positions.get(positionId);
    if (!position) return;

    const amplifiedWeight = position.originalWeight * this.amplificationFactor;
    this.amplifiedPositions.add(positionId);
    
    this.emit('amplified', {
      positionId,
      originalWeight: position.originalWeight,
      amplifiedWeight,
      supportRatio: position.supportRatio
    });
  }

  getAmplifiedPositions() {
    return Array.from(this.amplifiedPositions);
  }

  getPositionWeight(positionId) {
    const position = this.positions.get(positionId);
    if (!position) return 0;
    
    return this.amplifiedPositions.has(positionId) 
      ? position.originalWeight * this.amplificationFactor
      : position.originalWeight;
  }

  reset() {
    this.positions.clear();
    this.amplifiedPositions.clear();
  }
}

function createAmplifier(options) {
  return new MinorityAmplifier(options);
}

module.exports = {
  MinorityAmplifier,
  createAmplifier
};