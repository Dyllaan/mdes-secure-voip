import Page from '@/components/layout/Page';
import Section, { SectionHeader } from '@/components/layout/Section';

export default function ToS() {
  return (
    <Page header footer>
        <SectionHeader title="Terms of Service" updated="April 2026" />

        <Section title="Acceptance">
          <p>
            By accessing or using mdes at mdes.sh, you agree to be bound by these terms. If you do not agree, do not use the service. mdes is operated by a private individual and is provided as-is.
          </p>
        </Section>

        <Section title="Eligibility">
          <p>You must be at least 13 years old to use mdes. By creating an account, you confirm you meet this requirement.</p>
        </Section>

        <Section title="Your account">
          <p>
            You are responsible for maintaining the security of your account. Do not share your credentials. You are responsible for all activity that occurs under your account. We reserve the right to suspend or terminate accounts that violate these terms.
          </p>
        </Section>

        <Section title="Acceptable use">
          <p className="mb-4">You agree not to use mdes to:</p>
          <ul className="space-y-2 list-disc list-inside">
            <li>Harass, threaten, or abuse other users</li>
            <li>Distribute illegal content, including content that violates copyright</li>
            <li>Attempt to gain unauthorised access to the service or its infrastructure</li>
            <li>Disrupt or degrade the service for other users</li>
            <li>Distribute malware or engage in phishing</li>
            <li>Violate any applicable law or regulation</li>
          </ul>
          <p className="mt-4">We reserve the right to remove content and terminate accounts that violate these rules, at our sole discretion.</p>
        </Section>

        <Section title="Content">
          <p>
            You retain ownership of any content you post. By posting content, you grant us a limited licence to store and transmit it as necessary to provide the service. We do not claim any ownership over your messages or files.
          </p>
        </Section>

        <Section title="YouTube integration">
          <p>
            The music bot feature streams content from YouTube. Use of this feature must comply with YouTube's Terms of Service. We are not responsible for the availability or content of third-party media.
          </p>
        </Section>

        <Section title="Service availability">
          <p>
            We make no guarantees about uptime or availability. The service may be interrupted, modified, or discontinued at any time without notice. We are not liable for any loss resulting from unavailability of the service.
          </p>
        </Section>

        <Section title="Limitation of liability">
          <p>
            mdes is provided without warranty of any kind. To the fullest extent permitted by law, we are not liable for any direct, indirect, incidental, or consequential damages arising from your use of the service.
          </p>
        </Section>

        <Section title="Governing law">
          <p>These terms are governed by the laws of England and Wales. Any disputes shall be subject to the exclusive jurisdiction of the courts of England and Wales.</p>
        </Section>

        <Section title="Changes to these terms">
          <p>We may update these terms at any time. Continued use of mdes after changes are posted constitutes acceptance of the updated terms.</p>
        </Section>

        <Section title="Contact">
          <p>For any questions regarding these terms, you can reach us via the GitHub repository linked on the homepage.</p>
        </Section>
      </Page>
  );
}