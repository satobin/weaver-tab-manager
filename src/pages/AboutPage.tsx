import { CloudOff, Eye, HardDrive } from 'lucide-react';

import packageMetadata from '../../package.json';
import { CHROME_WEB_STORE_URL } from '../shared/storeLinks';

const GITHUB_ISSUES_URL = 'https://github.com/satobin/weaver-tab-manager/issues';

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
                <h4>Saves locally in your browser</h4>
                <p>
                  Saved windows, settings, and custom rules stay in your browser. Recently restored
                  tabs may temporarily keep their saved titles and URLs in memory until their pages
                  load, the tabs navigate or close, or the browser exits.
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
        <div className="about-community">
          <p>
            If you enjoy this extension,{' '}
            <a href={CHROME_WEB_STORE_URL} target="_blank" rel="noreferrer">
              please leave a review
            </a>
            .
          </p>
          <p>
            For issues or feature requests, please{' '}
            <a href={GITHUB_ISSUES_URL} target="_blank" rel="noreferrer">
              open a GitHub issue
            </a>
            .
          </p>
          <p>
            For other questions, email{' '}
            <a href="mailto:weavertabmanager@gmail.com">weavertabmanager@gmail.com</a>.
          </p>
        </div>
      </div>
    </section>
  );
}
