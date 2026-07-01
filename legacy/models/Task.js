const mongoose = require('mongoose');

const TaskSchema = new mongoose.Schema({
  id: Number,
  name: String,
  description: String,
  status: {
    type: String,
    enum: ['backlog', 'in-progress', 'complete'],
    default: 'backlog'
  }
});

module.exports = mongoose.model('Task', TaskSchema);
