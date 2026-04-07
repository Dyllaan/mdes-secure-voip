import Page from "@/components/layout/Page";
import { Link } from "react-router";

export default function NotFound() {
    return (
        <Page header footer>
            <div className="text-center mt-8">
                <h2 className="text-2xl font-semibold mb-4">Oops! Page not found.</h2>
                <Link to="/" className="text-blue-500 hover:underline">Go back to Home</Link>
            </div>
        </Page>
    )
}