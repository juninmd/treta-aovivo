import ReactDOM from "react-dom/client";
import { Preview } from "./preview";

// ?col=before | after renders one full-width column, used for the PR screenshots.
const col = new URLSearchParams(location.search).get("col");
const only = col === "before" || col === "after" ? col : "both";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<Preview only={only} />);
