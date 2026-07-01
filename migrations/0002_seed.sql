-- 0002_seed.sql — initial board, ported from the original prototype data.
-- `rank` keys are pre-computed evenly-spaced fractional-index keys per lane
-- (a0, a1, a2, ...) matching the original priority order within each lane.

INSERT INTO clients (id, name, description, status, rank) VALUES
  (1,  'Stark, White and Abbott',           'Cloned Optimal Architecture',                           'in-progress', 'a0'),
  (4,  'Thompson PLC',                       'Streamlined Regional Knowledgeuser',                    'in-progress', 'a1'),
  (5,  'Walker-Williamson',                  'Team-Oriented 6Thgeneration Matrix',                    'in-progress', 'a2'),
  (15, 'Emmerich-Ankunding',                 'User-Centric Stable Extranet',                          'in-progress', 'a3'),
  (16, 'Willms-Abbott',                      'Progressive Bandwidth-Monitored Access',                'in-progress', 'a4'),

  (2,  'Wiza LLC',                           'Exclusive Bandwidth-Monitored Implementation',          'complete',    'a0'),
  (11, 'Reilly-King',                        'Future-Proofed Interactive Toolset',                    'complete',    'a1'),
  (13, 'Fritsch, Cronin and Wolff',          'Open-Source 3Rdgeneration Website',                     'complete',    'a2'),
  (17, 'Brekke PLC',                         'Intuitive User-Facing Customerloyalty',                 'complete',    'a3'),

  (3,  'Nolan LLC',                          'Vision-Oriented 4Thgeneration Graphicaluserinterface',  'backlog',     'a0'),
  (6,  'Boehm and Sons',                     'Automated Systematic Paradigm',                         'backlog',     'a1'),
  (7,  'Runolfsson, Hegmann and Block',      'Integrated Transitional Strategy',                      'backlog',     'a2'),
  (8,  'Schumm-Labadie',                     'Operative Heuristic Challenge',                         'backlog',     'a3'),
  (9,  'Kohler Group',                       'Re-Contextualized Multi-Tasking Attitude',              'backlog',     'a4'),
  (10, 'Romaguera Inc',                      'Managed Foreground Toolset',                            'backlog',     'a5'),
  (12, 'Emard, Champlin and Runolfsdottir',  'Devolved Needs-Based Capability',                       'backlog',     'a6'),
  (14, 'Borer LLC',                          'Profit-Focused Incremental Orchestration',              'backlog',     'a7'),
  (18, 'Bins, Toy and Klocko',               'Integrated Assymetric Software',                        'backlog',     'a8'),
  (19, 'Hodkiewicz-Hayes',                   'Programmable Systematic Securedline',                   'backlog',     'a9'),
  (20, 'Murphy, Lang and Ferry',             'Organized Explicit Access',                             'backlog',     'aA')
ON CONFLICT (id) DO NOTHING;

SELECT setval('clients_id_seq', (SELECT COALESCE(MAX(id), 1) FROM clients));
