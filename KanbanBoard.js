import React, { useState, useEffect, useRef } from 'react';
import dragula from 'dragula';
import 'dragula/dist/dragula.min.css';

const columns = {
  backlog: { id: 'backlog-swimlane', title: 'Backlog' },
  'in-progress': { id: 'in-progress-swimlane', title: 'In Progress' },
  complete: { id: 'complete-swimlane', title: 'Complete' },
};

// Example initial clients/tasks
const initialClients = [
  { id: 1, title: 'Client 1', status: 'backlog' },
  { id: 2, title: 'Client 2', status: 'in-progress' },
  { id: 3, title: 'Client 3', status: 'complete' },
];

export default function KanbanBoard() {
  const [clients, setClients] = useState(initialClients);
  const dragulaRef = useRef(null);

  useEffect(() => {
    // Initialize dragula on the three columns by their DOM ids
    dragulaRef.current = dragula(
      Object.values(columns).map((col) => document.getElementById(col.id))
    );

    dragulaRef.current.on('drop', (el, target, source, sibling) => {
      if (target && target.id) {
        const cardId = parseInt(el.dataset.id, 10);
        let newStatus = '';

        switch (target.id) {
          case 'backlog-swimlane':
            newStatus = 'backlog';
            break;
          case 'in-progress-swimlane':
            newStatus = 'in-progress';
            break;
          case 'complete-swimlane':
            newStatus = 'complete';
            break;
          default:
            return;
        }

        // Update local state
        setClients((prevClients) =>
          prevClients.map((client) =>
            client.id === cardId ? { ...client, status: newStatus } : client
          )
        );

        // API call to update backend
        fetch(`http://localhost:3001/api/v1/clients/${cardId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        })
          .then((response) => {
            if (!response.ok) throw new Error('Failed to update task');
            return response.json();
          })
          .then((data) => {
            console.log('✅ Backend update successful', data);
          })
          .catch((error) => {
            console.error('❌ Error updating task on server:', error);
          });
      }
    });

    // Cleanup on unmount
    return () => {
      if (dragulaRef.current) {
        dragulaRef.current.destroy();
      }
    };
  }, []);

  return (
    <div style={{ display: 'flex', gap: 20 }}>
      {Object.values(columns).map(({ id, title }) => (
        <div
          key={id}
          id={id}
          style={{
            flex: 1,
            padding: 10,
            border: '1px solid #ccc',
            borderRadius: 5,
            minHeight: 200,
            backgroundColor: '#f4f4f4',
          }}
        >
          <h3>{title}</h3>
          {clients
            .filter((client) => {
              // map status to column id
              if (client.status === 'backlog' && id === 'backlog-swimlane') return true;
              if (client.status === 'in-progress' && id === 'in-progress-swimlane') return true;
              if (client.status === 'complete' && id === 'complete-swimlane') return true;
              return false;
            })
            .map(({ id: clientId, title: clientTitle }) => (
              <div
                key={clientId}
                data-id={clientId}
                style={{
                  padding: '8px 12px',
                  margin: '6px 0',
                  backgroundColor: 'white',
                  borderRadius: 3,
                  cursor: 'grab',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }}
              >
                {clientTitle}
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}
