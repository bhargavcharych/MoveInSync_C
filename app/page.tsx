"use client";

import { useState } from "react";
import { Dashboard } from "@/components/dashboard";
import type { Persona } from "@/lib/types";
import { CarFront, Building2, UsersRound, Sparkles } from "lucide-react";

export default function Home() {
  const [persona, setPersona] = useState<Persona | null>(null);

  if (persona) {
    return <Dashboard initialPersona={persona} onLogout={() => setPersona(null)} />;
  }

  return (
    <div className="login-container">
      <div className="login-box">
        <div className="brand login-brand">
          <span><Sparkles size={24} /></span>
          <div>
            <strong>MoveinSync</strong>
            <small>Pulse intelligence</small>
          </div>
        </div>
        <h2>Select your persona</h2>
        <p>Log in to your personalized command center.</p>
        <div className="persona-buttons">
          <button onClick={() => setPersona("transport_manager")}>
            <CarFront size={20} />
            <div>
              <strong>Transport Manager</strong>
              <small>Operational</small>
            </div>
          </button>
          <button onClick={() => setPersona("facilities_head")}>
            <Building2 size={20} />
            <div>
              <strong>Facilities Head</strong>
              <small>Strategic</small>
            </div>
          </button>
          <button onClick={() => setPersona("line_manager")}>
            <UsersRound size={20} />
            <div>
              <strong>Line Manager</strong>
              <small>Shift-based</small>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
