const nodemailer = require('nodemailer');

exports.notifyManagers = (task) => {
  const transporter = nodemailer.createTransport({
    service: 'Gmail',
    auth: {
      user: 'your-email@gmail.com',     // Use environment variables
      pass: 'your-password'
    }
  });

  const mailOptions = {
    from: 'your-email@gmail.com',
    to: 'manager@company.com',          // Add logic for dynamic addresses
    subject: `Task Completed: ${task.name}`,
    text: `The following task has been completed: ${task.name}\n\nDescription: ${task.description}`
  };

  transporter.sendMail(mailOptions, (err, info) => {
    if (err) console.error('Error sending email:', err);
    else console.log('Notification email sent:', info.response);
  });
};
