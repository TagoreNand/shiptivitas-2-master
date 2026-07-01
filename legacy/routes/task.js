const express = require('express');
const router = express.Router();
const Task = require('../models/Task');

// Get all tasks
router.get('/', async (req, res) => {
  try {
    const tasks = await Task.find();
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update task status
router.put('/:id', async (req, res) => {
  try {
    const { status } = req.body;
    const task = await Task.findOneAndUpdate({ id: req.params.id }, { status }, { new: true });

    if (!task) return res.status(404).json({ message: 'Task not found' });

    if (status === 'complete') {
      require('../utils/notifier').notifyManagers(task);
    }

    res.json(task);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;
