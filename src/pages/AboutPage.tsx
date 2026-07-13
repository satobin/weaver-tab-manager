import { CloudOff, Eye, HardDrive } from 'lucide-react';

import packageMetadata from '../../package.json';

export function AboutPage() {
  return (
    <section className="about-layout" aria-labelledby="about-heading">
      <img src="/icons/default-128.png" alt="Weaver folder with heart" width="88" height="88" />
      <div>
        <h2 id="about-heading">Weaver</h2>
        <p className="about-subtitle">Window &amp; Tab Manager</p>
        <p>
          A private-by-default browser workspace for organizing active windows and saving useful tab
          sets for later.
        </p>
        <section className="about-privacy" aria-labelledby="about-privacy-heading">
          <h3 id="about-privacy-heading">Privacy</h3>
          <p className="about-privacy-lede">Your tabs stay on this device.</p>
          <div className="about-privacy-list">
            <article className="about-privacy-item">
              <span className="about-privacy-icon">
                <Eye aria-hidden="true" size={20} />
              </span>
              <div>
                <h4>Reads open-tab details</h4>
                <p>
                  Titles, URLs, site icons, groups, and active, pinned, suspended, and window state
                  are used only to provide Weaver's tab and window-management features.
                </p>
              </div>
            </article>
            <article className="about-privacy-item">
              <span className="about-privacy-icon">
                <HardDrive aria-hidden="true" size={20} />
              </span>
              <div>
                <h4>Saves locally in Chrome</h4>
                <p>
                  Saved windows, settings, and custom rules stay in Chrome. Restored suspended tabs
                  may keep their titles and URLs in memory until they load, change, close, or Chrome
                  exits.
                </p>
              </div>
            </article>
            <article className="about-privacy-item">
              <span className="about-privacy-icon">
                <CloudOff aria-hidden="true" size={20} />
              </span>
              <div>
                <h4>No external data collection</h4>
                <p>
                  Weaver has no account, analytics, advertising, or cloud service. It does not send
                  your tab list, saved windows, settings, or custom rules off your device, and it
                  does not sell browsing data.
                </p>
              </div>
            </article>
          </div>
        </section>
        <dl className="about-facts">
          <div>
            <dt>Version</dt>
            <dd>{packageMetadata.version}</dd>
          </div>
          <div>
            <dt>Data</dt>
            <dd>Processed and stored locally</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
