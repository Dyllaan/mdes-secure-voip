import Page from "@/components/layout/Page";
import { Link } from "react-router";

export default function NotFound() {
    return (
        <Page title="404 - Not Found" subtitle="The page you are looking for does not exist.">
            <div className="text-center mt-8">
                <Link to="/" className="text-blue-500 hover:underline">Go back to Home</Link>
            </div>
        </Page>
    )
}