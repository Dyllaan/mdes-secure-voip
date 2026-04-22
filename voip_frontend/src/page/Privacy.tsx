import Page from '@/components/layout/Page';
import Section, {SectionHeader} from '@/components/layout/Section';

export default function Privacy() {
  return (
    <Page header footer>
        <SectionHeader title="Privacy Policy" updated="April 2026" />

        <Section title="Overview">
          <p>
            This policy explains what data mdes (accessible at mdes.sh) collects, how it is used, and how it is stored.
            mdes is operated by a private individual. By using mdes, you agree to this policy.
          </p>
        </Section>

        <Section title="Data we collect">
          <p className="mb-4">We collect only what is necessary to operate the service:</p>
          <ul className="space-y-2 text-muted-foreground">
            <li><span className="text-foreground font-medium">Username</span> chosen by you at registration. This is the only personally identifying information we store.</li>
            <li><span className="text-foreground font-medium">Messages</span> messages sent in rooms and direct messages are stored in a database hosted on EU-based infrastructure. Room and ephemeral messages are encrypted with AES-GCM.</li>
            <li><span className="text-foreground font-medium">Account credentials</span> your password is hashed and never stored in plaintext.</li>
          </ul>
        </Section>

        <Section title="Data we do not collect">
          <p>We do not collect your email address, phone number, real name, IP address logs, or any behavioural analytics. We do not use tracking cookies or third-party analytics services.</p>
        </Section>

        <Section title="How your data is used">
          <p>Your data is used solely to provide the mdes service. We do not sell, share, or transfer your data to any third party. Your username and messages are never used for advertising or profiling.</p>
        </Section>

        <Section title="Data storage and security">
          <p>
            All data is stored on privately operated servers located within the European Union. We take reasonable technical measures to protect stored data, including encrypted connections (TLS) and encrypted message storage. However, no system is completely secure and we cannot guarantee absolute security.
          </p>
        </Section>

        <Section title="YouTube integration">
          <p>
            mdes includes a music bot that streams audio from YouTube using credentials operated by us. This feature does not collect or transmit any personal data about you to YouTube or any other third party.
          </p>
        </Section>

        <Section title="Data retention and deletion">
          <p>
            Your data is retained for as long as your account exists. You may request deletion of your account and all associated data by contacting us. Upon deletion, your username and stored messages will be permanently removed from our systems.
          </p>
        </Section>

        <Section title="Age requirement">
          <p>mdes is intended for users aged 13 and over. By registering, you confirm that you meet this requirement.</p>
        </Section>

        <Section title="Changes to this policy">
          <p>We may update this policy from time to time. Continued use of mdes after changes are posted constitutes acceptance of the updated policy.</p>
        </Section>

        <Section title="Contact">
          <p>For any questions or data deletion requests, you can reach us via the GitHub repository linked on the homepage.</p>
        </Section>
      </Page>
  );
}