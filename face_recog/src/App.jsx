import React from "react";
import { BrowserRouter as Router, Routes, Route, Link } from "react-router-dom";
import FacePortal from "./FacePortal";

// Simple pages
const Home = () => {
  return <h2>Home Page</h2>;
};

const About = () => {
  return <h2>About Page</h2>;
};

const Contact = () => {
  return <h2>Contact Page</h2>;
};

// Main App
const App = () => {
  return (
    <Router>

      {/* Routes */}
      <Routes>
     
        <Route path="/" element={<FacePortal />} />
    
      </Routes>
    </Router>
  );
};

export default App;