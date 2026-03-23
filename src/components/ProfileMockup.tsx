export default function ProfileMockup() {
  return (
    <div className="landing-profile-card">
      <div className="landing-profile-group">
        <h4 className="landing-profile-group-label">Basics</h4>
        <div className="landing-profile-fields">
          <div className="landing-profile-field">
            <span className="landing-profile-field-label">Age</span>
            <span className="landing-profile-field-value">32</span>
          </div>
          <div className="landing-profile-field">
            <span className="landing-profile-field-label">Height</span>
            <span className="landing-profile-field-value">5'10"</span>
          </div>
          <div className="landing-profile-field">
            <span className="landing-profile-field-label">Weight</span>
            <span className="landing-profile-field-value">185 lbs</span>
          </div>
        </div>
      </div>

      <div className="landing-profile-group">
        <h4 className="landing-profile-group-label">1RM Lifts</h4>
        <div className="landing-profile-fields">
          <div className="landing-profile-field">
            <span className="landing-profile-field-label">Back Squat</span>
            <span className="landing-profile-field-value">315</span>
          </div>
          <div className="landing-profile-field">
            <span className="landing-profile-field-label">Clean & Jerk</span>
            <span className="landing-profile-field-value">225</span>
          </div>
          <div className="landing-profile-field">
            <span className="landing-profile-field-label">Snatch</span>
            <span className="landing-profile-field-value">175</span>
          </div>
        </div>
      </div>

      <div className="landing-profile-group">
        <h4 className="landing-profile-group-label">Skills</h4>
        <div className="landing-profile-fields">
          <div className="landing-profile-field">
            <span className="landing-profile-field-label">Bar Muscle-Ups</span>
            <span className="landing-profile-field-value landing-profile-skill-tag">Intermediate</span>
          </div>
          <div className="landing-profile-field">
            <span className="landing-profile-field-label">Double-Unders</span>
            <span className="landing-profile-field-value landing-profile-skill-tag">Advanced</span>
          </div>
          <div className="landing-profile-field">
            <span className="landing-profile-field-label">HSPU</span>
            <span className="landing-profile-field-value landing-profile-skill-tag">Beginner</span>
          </div>
        </div>
      </div>

      <div className="landing-profile-group">
        <h4 className="landing-profile-group-label">Conditioning</h4>
        <div className="landing-profile-fields">
          <div className="landing-profile-field">
            <span className="landing-profile-field-label">1 Mile Run</span>
            <span className="landing-profile-field-value">6:45</span>
          </div>
          <div className="landing-profile-field">
            <span className="landing-profile-field-label">2k Row</span>
            <span className="landing-profile-field-value">7:12</span>
          </div>
        </div>
      </div>

      <div className="landing-profile-more">+ 30 more fields across lifts, skills, equipment & benchmarks</div>
    </div>
  );
}
