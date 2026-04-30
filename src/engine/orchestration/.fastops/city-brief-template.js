// city-brief-template.js
// FastOps City Daily Brief Generator and Dissent Formatter
// mistral-small-mngsdd9a-08a7c3

const fs = require('fs');
const path = require('path');

class CityBrief {
  constructor() {
    this.briefContent = '';
    this.today = new Date().toISOString().split('T')[0].replace(/-/g, '-');
  }

  generateBrief(data) {
    this.briefContent = `# FastOps City Brief: ${this.today}\n\nApproval: Pending\n\n`;

    // (1) GROUND TRUTH
    this._buildGroundTruth(data);

    // (2) FRACTURES
    this._buildFractures(data);

    // (3) DISSENT MAP
    this._buildDissentMap(data);

    // (4) REMEDIATION PUNCH LIST
    this._buildRemediationPunchList(data);

    // (5) DIRECTION
    this._buildDirection(data);

    // (6) BLIND SPOTS
    this._buildBlindSpots(data);

    return this._saveBrief();
  }

  formatBrief(pipelineArtifact) {
    const data = JSON.parse(fs.readFileSync(pipelineArtifact));
    return this.generateBrief(data);
  }

  approveBrief() {
    const briefPath = this._getBriefPath();
    if (fs.existsSync(briefPath)) {
      const content = fs.readFileSync(briefPath, 'utf8');
      return content.replace(/Approval: .*/, 'Approval: Joel-approved');
    }
    return 'No brief found to approve';
  }

  checkStatus() {
    const briefPath = this._getBriefPath();
    if (fs.existsSync(briefPath)) {
      const content = fs.readFileSync(briefPath, 'utf8');
      return content.includes('Approval: Joel-approved')
        ? 'Approved'
        : 'Exists but not approved';
    }
    return 'Does not exist';
  }

  _getBriefPath() {
    return path.join(__dirname, `../daily-brief-${this.today}.md`);
  }

  _saveBrief() {
    const briefPath = this._getBriefPath();
    fs.writeFileSync(briefPath, this.briefContent);
    return `Brief saved to ${briefPath}`;
  }

  // (1) GROUND TRUTH implementation
  _buildGroundTruth(data) {
    this.briefContent += '## GROUND TRUTH\n\n';
    if (data && data.groundTruth) {
      this.briefContent += `${data.groundTruth}\n\n`;
    } else {
      this.briefContent += 'No ground truth data available\n\n';
    }
  }

  // (2) FRACTURES implementation
  _buildFractures(data) {
    this.briefContent += '## FRACTURES\n\n';
    if (data && data.fractures) {
      data.fractures.forEach(fracture => {
        this.briefContent += `- [SEV-${fracture.severity}] ${fracture.description} (identified by models ${fracture.identifyingModels.join(', ')})\n`;
      });
    } else {
      this.briefContent += 'No fractures detected\n\n';
    }
  }

  // (3) DISSENT MAP implementation
  _buildDissentMap(data) {
    this.briefContent += '## DISSENT MAP\n\n';
    if (data && data.dissentMap) {
      data.dissentMap.forEach(item => {
        if (item.percentage >= 30) {
          this.briefContent += `- ${item.issue}: ${item.percentage}% dissent (${item.reasons.join(', ')})\n`;
        }
      });
    } else {
      this.briefContent += 'No dissent detected\n\n';
    }
  }

  // (4) REMEDIATION PUNCH LIST implementation
  _buildRemediationPunchList(data) {
    this.briefContent += '## REMEDIATION PUNCH LIST\n\n';
    if (data && data.remediation) {
      data.remediation.forEach(item => {
        this.briefContent += `- [${item.status}] ${item.task} (assigned to ${item.assignedTo})\n`;
      });
    } else {
      this.briefContent += 'No remediation tasks identified\n\n';
    }
  }

  // (5) DIRECTION implementation
  _buildDirection(data) {
    this.briefContent += '## DIRECTION\n\n';
    if (data && data.direction) {
      this.briefContent += `${data.direction}\n\n`;
    } else {
      this.briefContent += 'No direction specified\n\n';
    }
  }

  // (6) BLIND SPOTS implementation
  _buildBlindSpots(data) {
    this.briefContent += '## BLIND SPOTS\n\n';
    if (data && data.blindSpots) {
      data.blindSpots.forEach(spot => {
        this.briefContent += `- ${spot.description} (not addressed by any model)\n`;
      });
    } else {
      this.briefContent += 'No blind spots detected\n\n';
    }
  }
}

module.exports = CityBrief;