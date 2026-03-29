import React from "react";
import ReactDOM from "react-dom/client";
import FaceVerify from "./FaceVerify";
import "@aws-amplify/ui-react/styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <FaceVerify />
  </React.StrictMode>
);